// Module web worker running a Pyodide (Python + pandas/numpy) sandbox.
//
// Why this shape:
// - Pyodide is imported FROM THE jsDelivr CDN at runtime (kept external on
//   purpose via @vite-ignore) so it is never bundled. The app stays small and
//   works identically on any static host (Vercel, Netlify, …) with no server.
// - Runs in a Worker so a multi-second pandas computation never freezes the UI.
// - The user's FULL CSV is loaded once into a DataFrame `df`; the Python globals
//   persist between runs, so an agent can build up an analysis across calls.
// - Single-threaded Pyodide needs no COOP/COEP headers — nothing to configure
//   per host.

const PYODIDE_VERSION = '0.27.2';
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// `self` is typed as a window in the default lib; treat it loosely to avoid
// DOM/WebWorker lib conflicts.
const ctx: any = self;

let pyodide: any = null;
let loadedHash = '';
let stdoutBuf: string[] = [];

async function ensurePyodide(): Promise<any> {
  if (pyodide) return pyodide;
  const { loadPyodide } = await import(/* @vite-ignore */ `${CDN}pyodide.mjs`);
  pyodide = await loadPyodide({ indexURL: CDN });
  await pyodide.loadPackage(['pandas', 'numpy']);
  pyodide.setStdout({ batched: (s: string) => stdoutBuf.push(s) });
  pyodide.setStderr({ batched: (s: string) => stdoutBuf.push(s) });
  return pyodide;
}

// Cheap content hash so we only re-parse the CSV into `df` when it changes.
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `${h}:${s.length}`;
}

ctx.onmessage = async (e: MessageEvent) => {
  const { id, code, csv } = e.data || {};
  try {
    const py = await ensurePyodide();

    // (Re)load the dataframe only when the source file changes.
    const h = hash(csv ?? '');
    if (h !== loadedHash) {
      py.globals.set('__csv__', csv ?? '');
      await py.runPythonAsync(
        ['import pandas as pd, numpy as np, io', 'df = pd.read_csv(io.StringIO(__csv__))', 'del __csv__'].join('\n')
      );
      loadedHash = h;
    }

    // Auto-install any importable packages the agent's code references (best
    // effort — ignore ones not in the Pyodide repo).
    try {
      await py.loadPackagesFromImports(code);
    } catch {
      /* keep going — the import error (if any) will surface from the run */
    }

    stdoutBuf = [];
    await py.runPythonAsync(code);
    ctx.postMessage({ id, stdout: stdoutBuf.join('') });
  } catch (err: any) {
    // Pyodide puts the full Python traceback in err.message — pass it back so
    // the agent can read its own error and fix the code.
    ctx.postMessage({ id, stdout: stdoutBuf.join(''), error: String(err?.message ?? err) });
  }
};
