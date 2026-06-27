// Structured editor for `data:` nodes — a popover anchored under the selected
// node with a method dropdown, endpoint, headers, and body. Config lives on the
// node as `http` (the canvas text is kept as a readable summary). Self-mounting.
import { useEffect, useReducer } from 'react';
import { useUI } from '../store/ui';
import type { Controller } from '../engine/controller';
import { dataSummary, isDataNode, parseDataText, runAINode, type HttpConfig } from './ainodes';

type AnyObj = Record<string, any>;

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const CSS = `
.data-editor{position:fixed;z-index:17;width:330px;background:var(--surface);color:var(--text);border-radius:12px;
  box-shadow:0 10px 40px rgba(0,0,0,.45);padding:12px;font-size:12.5px;border:1px solid var(--surface-2)}
.data-editor .row{display:flex;gap:6px;align-items:center}
.data-editor label{display:block;color:var(--text-dim);font-size:10.5px;margin:9px 0 3px;letter-spacing:.02em;text-transform:uppercase}
.data-editor input,.data-editor textarea,.data-editor select{box-sizing:border-box;background:var(--border);border:none;
  border-radius:7px;color:var(--text);padding:7px 9px;font-size:12.5px;outline:none;font-family:inherit}
.data-editor input:focus,.data-editor textarea:focus,.data-editor select:focus{box-shadow:0 0 0 1.5px var(--accent)}
.data-editor .url{flex:1;min-width:0}
.data-editor select.method{font-weight:600;cursor:pointer;padding-right:6px}
.data-editor textarea{width:100%;resize:vertical;min-height:60px;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.data-editor .hdr{display:flex;gap:6px;margin-top:5px}
.data-editor .hdr input{flex:1;min-width:0}
.data-editor .hdr button,.data-editor .addhdr{border:none;background:var(--surface-2);color:#cfcfd6;border-radius:7px;
  cursor:pointer;padding:6px 9px;font-size:12px}
.data-editor .hdr button:hover,.data-editor .addhdr:hover{background:var(--surface-hover)}
.data-editor .addhdr{margin-top:6px}
.data-editor .foot{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
.data-editor .send{border:none;border-radius:8px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;
  color:#fff;background:linear-gradient(135deg,var(--accent),#6741d9)}
.data-editor .send:hover{filter:brightness(1.08)}
.data-editor .note{color:#6f6f78;font-size:10.5px}
`;

export default function DataNodeEditor({ ctl }: { ctl: Controller }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selection = useUI((s) => s.selection);
  useUI((s) => s.docVersion);

  useEffect(() => {
    const offCam = ctl.onCamera(force);
    const offDoc = ctl.doc.subscribe(force);
    return () => {
      offCam?.();
      offDoc?.();
    };
  }, [ctl]);

  if (selection.length !== 1) return null;
  const node = ctl.doc.get(selection[0]!) as AnyObj | undefined;
  if (!node || !isDataNode(node)) return null;
  if (ctl.camera.zoom < 0.18) return null;

  const cfg: HttpConfig = node.http && node.http.url !== undefined ? node.http : parseDataText(node.text);
  const method = (cfg.method || 'GET').toUpperCase();
  const headers = cfg.headers ?? [];

  const write = (next: HttpConfig) => {
    ctl.doc.update(node.id, { http: next, text: dataSummary(next) } as AnyObj);
  };
  const patch = (p: Partial<HttpConfig>) => write({ method, url: cfg.url ?? '', headers, body: cfg.body ?? '', ...p });
  const setHeader = (i: number, key: string, value: string) => {
    const h = headers.slice();
    h[i] = { key, value };
    patch({ headers: h });
  };
  const addHeader = () => patch({ headers: [...headers, { key: '', value: '' }] });
  const removeHeader = (i: number) => patch({ headers: headers.filter((_, j) => j !== i) });

  // anchor under the node, clamped into the viewport
  const p = ctl.worldToScreenPt({ x: node.x, y: node.y + (node.h ?? 60) });
  const left = Math.max(8, Math.min(p.x, window.innerWidth - 338));
  const top = Math.min(p.y + 8, window.innerHeight - 360);
  const showBody = method !== 'GET';

  return (
    <>
      <style>{CSS}</style>
      <div
        className="data-editor"
        style={{ left, top }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <label>Endpoint</label>
        <div className="row">
          <select className="method" value={method} onChange={(e) => patch({ method: e.target.value })}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            className="url"
            placeholder="https://api.example.com/v1/items"
            value={cfg.url ?? ''}
            onChange={(e) => patch({ url: e.target.value })}
          />
        </div>

        <label>Headers</label>
        {headers.map((h, i) => (
          <div className="hdr" key={i}>
            <input placeholder="Authorization" value={h.key} onChange={(e) => setHeader(i, e.target.value, h.value)} />
            <input placeholder="Bearer …" value={h.value} onChange={(e) => setHeader(i, h.key, e.target.value)} />
            <button title="Remove header" onClick={() => removeHeader(i)}>
              ✕
            </button>
          </div>
        ))}
        <button className="addhdr" onClick={addHeader}>
          ＋ Add header
        </button>

        {showBody && (
          <>
            <label>Body {`(JSON)`}</label>
            <textarea
              placeholder={'{\n  "key": "value"\n}'}
              value={cfg.body ?? ''}
              onChange={(e) => patch({ body: e.target.value })}
            />
            <div className="note">Leave blank to use text wired into this node as the body.</div>
          </>
        )}

        <div className="foot">
          <span className="note">Output: status + JSON, ready to wire onward.</span>
          <button className="send" onClick={() => void runAINode(ctl, ctl.doc.get(node.id) as AnyObj)}>
            Send ▶
          </button>
        </div>
      </div>
    </>
  );
}
