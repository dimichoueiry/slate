// Registry of the currently mounted board controller so the MCP bridge can
// reach the live doc/engine. BoardView registers on mount, clears on unmount.

type AnyObj = Record<string, any>;

let activeCtl: AnyObj | null = null;
let activeBoardId: string | null = null;
const waiters = new Set<(ctl: AnyObj) => void>();

export function registerCtl(ctl: AnyObj, boardId: string) {
  activeCtl = ctl;
  activeBoardId = boardId;
  for (const w of [...waiters]) w(ctl);
}

export function unregisterCtl(ctl: AnyObj) {
  if (activeCtl === ctl) {
    activeCtl = null;
    activeBoardId = null;
  }
}

export function getActiveCtl(): { ctl: AnyObj; boardId: string } | null {
  return activeCtl && activeBoardId ? { ctl: activeCtl, boardId: activeBoardId } : null;
}

/** Resolve once a controller for `boardId` is mounted, or reject after `timeoutMs`. */
export function waitForBoard(boardId: string, timeoutMs = 8000): Promise<AnyObj> {
  const cur = getActiveCtl();
  if (cur && cur.boardId === boardId) return Promise.resolve(cur.ctl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiters.delete(onReg);
      reject(new Error(`Board ${boardId} did not open within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    const onReg = () => {
      const now = getActiveCtl();
      if (now && now.boardId === boardId) {
        clearTimeout(timer);
        waiters.delete(onReg);
        resolve(now.ctl);
      }
    };
    waiters.add(onReg);
  });
}
