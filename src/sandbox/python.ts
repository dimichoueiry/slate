// Main-thread API for the Pyodide Python sandbox (see python.worker.ts).
// One lazily-created worker is shared across calls. A runaway/hung execution is
// killed by terminating the worker (the only reliable way to interrupt Pyodide),
// after which the next call transparently spins up a fresh one.

export interface PyResult {
  stdout: string;
  /** present when the Python run raised — contains the traceback */
  error?: string;
}

let worker: Worker | null = null;
let nextId = 0;
interface Pending {
  resolve: (r: PyResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<number, Pending>();

function makeWorker(): Worker {
  const w = new Worker(new URL('./python.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent) => {
    const { id, stdout, error } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve({ stdout: stdout ?? '', error });
  };
  w.onerror = (e) => {
    // Worker-level failure (e.g. Pyodide couldn't be fetched from the CDN —
    // offline, blocked, etc.). Fail everything in flight and force a rebuild.
    const err = new Error(
      'Python sandbox failed to load' + (e.message ? `: ${e.message}` : ' (check your network — Pyodide loads from a CDN).')
    );
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    worker = null;
  };
  return w;
}

/**
 * Run Python in the sandbox with the given CSV preloaded as DataFrame `df`.
 * Returns whatever the code printed to stdout (and a Python traceback on error).
 * `timeoutMs` is generous on the first call because it also downloads Pyodide +
 * pandas (~tens of MB) from the CDN.
 */
export async function runPython(code: string, csv: string, opts: { timeoutMs?: number } = {}): Promise<PyResult> {
  if (typeof Worker === 'undefined') {
    throw new Error('This browser does not support web workers, which the Python sandbox needs.');
  }
  if (!worker) worker = makeWorker();
  const id = ++nextId;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise<PyResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      if (worker) {
        worker.terminate(); // kill the hung run; next call rebuilds a fresh sandbox
        worker = null;
      }
      reject(new Error(`Python execution timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, code, csv });
  });
}
