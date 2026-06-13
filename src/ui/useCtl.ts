// Shared hook: always returns the CURRENT live controller, re-rendering when a
// new board mounts a fresh Controller (window.__slateCtl is reassigned on resize).
import { useEffect, useState } from 'react';

export function useCtl(): any {
  const [ctl, setCtl] = useState<any>((window as any).__slateCtl ?? null);
  useEffect(() => {
    const tick = () => {
      const c = (window as any).__slateCtl;
      setCtl((prev: any) => (c && c !== prev ? c : prev));
    };
    tick();
    const t = setInterval(tick, 250); // cheap; updates the instant a board re-mounts
    return () => clearInterval(t);
  }, []);
  return ctl;
}
