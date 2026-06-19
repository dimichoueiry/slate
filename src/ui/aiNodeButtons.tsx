// Floating run buttons for ai: nodes — a real DOM button pinned to each
// node's top-right corner, with spinner + success flash. Self-mounting.
import { useEffect, useReducer, useRef, useState } from 'react';
import { useUI } from '../store/ui';
import type { Controller } from '../engine/controller';
import {
  applyUploadToNode,
  isAINode,
  isHiddenNode,
  isScheduleActive,
  isTickNode,
  isUploadIntent,
  isUploadNode,
  runAINode,
  toggleHiddenPrompt,
} from './ainodes';
import { readUpload } from './upload';

type AnyObj = Record<string, any>;

/** Accepted file types for the upload node's picker (shared with the toolbar button). */
export const UPLOAD_ACCEPT = '.csv,.tsv,.txt,.log,.json,.md,.markdown,.pdf,application/pdf,text/*';

const CSS = `
.slate-run-layer{position:fixed;inset:0;z-index:16;pointer-events:none;overflow:hidden}
.slate-run-btn{--f:1;position:absolute;pointer-events:auto;width:30px;height:30px;border:none;border-radius:50%;cursor:pointer;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#3c78ff,#6741d9);box-shadow:0 3px 10px rgba(40,60,160,.45);transition:transform .12s ease, box-shadow .12s ease;transform:scale(var(--f));transform-origin:center}
.slate-run-btn:hover{transform:scale(calc(var(--f)*1.15));box-shadow:0 5px 16px rgba(40,60,160,.6)}
.slate-run-btn:active{transform:scale(calc(var(--f)*.95))}
.slate-run-btn.running{cursor:default;background:linear-gradient(135deg,#5a5a64,#3a3a44)}
.slate-run-btn.done{background:linear-gradient(135deg,#2f9e44,#37b24d)}
.slate-run-btn.ticking{background:linear-gradient(135deg,#0ca678,#099268);animation:slate-pulse 1.6s ease-in-out infinite}
@keyframes slate-pulse{0%,100%{box-shadow:0 3px 10px rgba(12,166,120,.45)}50%{box-shadow:0 3px 18px rgba(12,166,120,.9)}}
.slate-run-btn .spin{width:13px;height:13px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:slate-spin .7s linear infinite}
@keyframes slate-spin{to{transform:rotate(360deg)}}
.slate-lock-btn{position:absolute;pointer-events:auto;width:22px;height:22px;border:none;border-radius:50%;cursor:pointer;font-size:10px;display:flex;align-items:center;justify-content:center;background:rgba(28,28,32,.92);color:#9a9aa2;box-shadow:0 2px 8px rgba(0,0,0,.3);transform:scale(var(--f));transform-origin:center}
.slate-lock-btn:hover{color:#fff;background:#3c78ff}
.slate-lock-btn.locked{background:#6741d9;color:#fff}
.slate-upload-btn{--f:1;position:absolute;pointer-events:auto;height:30px;padding:0 11px;border:none;border-radius:15px;cursor:pointer;color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;white-space:nowrap;background:linear-gradient(135deg,#1f6feb,#2f81f7);box-shadow:0 3px 10px rgba(31,111,235,.45);transition:transform .12s ease, box-shadow .12s ease;transform:scale(var(--f));transform-origin:center}
.slate-upload-btn:hover{transform:scale(calc(var(--f)*1.08));box-shadow:0 5px 16px rgba(31,111,235,.6)}
.slate-upload-btn:active{transform:scale(calc(var(--f)*.96))}
.slate-upload-btn.busy{cursor:default;background:linear-gradient(135deg,#5a5a64,#3a3a44)}
.slate-upload-btn .spin{width:12px;height:12px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:slate-spin .7s linear infinite}
`;

export default function RunButtons({ ctl }: { ctl: Controller }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useUI((s) => s.docVersion);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    const offCam = ctl.onCamera(force);
    const offDoc = ctl.doc.subscribe(force);
    return () => {
      offCam?.();
      offDoc?.();
    };
  }, [ctl]);

  const [busyUpload, setBusyUpload] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingId = useRef<string | null>(null);

  const pickFile = (nodeId: string) => {
    pendingId.current = nodeId;
    fileRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    const id = pendingId.current;
    pendingId.current = null;
    if (!file || !id) return;
    setBusyUpload((s) => new Set(s).add(id));
    try {
      const payload = await readUpload(file);
      applyUploadToNode(ctl, id, payload);
    } catch (err) {
      const o = ctl.doc.get(id);
      if (o) ctl.doc.update(id, { text: `📎 upload: ⚠ ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusyUpload((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };

  const zoom = ctl.camera.zoom;
  if (zoom < 0.18) return null; // overview zoom — buttons would be noise
  const f = Math.max(0.45, Math.min(1.25, zoom)); // button scales with the canvas, within reason
  const nodes = ctl.doc.all().filter((o: AnyObj) => isAINode(o));
  const uploads = ctl.doc.all().filter((o: AnyObj) => isUploadIntent(o));

  const run = async (node: AnyObj) => {
    if (running.has(node.id)) return;
    setRunning((s) => new Set(s).add(node.id));
    try {
      await runAINode(ctl, node);
      if (isTickNode(node)) return; // schedules show their own ⏱ state, not a ✓ flash
      setDone((s) => new Set(s).add(node.id));
      setTimeout(
        () =>
          setDone((s) => {
            const n = new Set(s);
            n.delete(node.id);
            return n;
          }),
        1600
      );
    } finally {
      setRunning((s) => {
        const n = new Set(s);
        n.delete(node.id);
        return n;
      });
    }
  };

  return (
    <>
      <style>{CSS}</style>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        hidden
        onChange={(e) => void onFile(e)}
      />
      <div className="slate-run-layer">
        {uploads.map((node: AnyObj) => {
          const p = ctl.worldToScreenPt({ x: node.x + (node.w ?? 160), y: node.y });
          const busy = busyUpload.has(node.id);
          const has = isUploadNode(node);
          return (
            <button
              key={node.id}
              className={`slate-upload-btn${busy ? ' busy' : ''}`}
              style={{ left: p.x - 8 * f, top: p.y - 15 * f, ['--f' as any]: f }}
              title={has ? 'Replace the file' : 'Choose a file to upload (CSV, PDF, text…)'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => !busy && pickFile(node.id)}
            >
              {busy ? <span className="spin" /> : <>📎 {has ? 'Replace' : 'Choose file'}</>}
            </button>
          );
        })}
        {nodes.map((node: AnyObj) => {
          const p = ctl.worldToScreenPt({ x: node.x + (node.w ?? 160), y: node.y });
          const isRunning = running.has(node.id);
          const isDone = done.has(node.id);
          const locked = isHiddenNode(node);
          const tick = isTickNode(node);
          const ticking = tick && isScheduleActive(node.id);
          return (
            <span key={node.id}>
              <button
                className={`slate-run-btn${isRunning ? ' running' : ''}${isDone ? ' done' : ''}${ticking ? ' ticking' : ''}`}
                style={{ left: p.x - 15 * f, top: p.y - 15 * f, ['--f' as any]: f }}
                title={ticking ? 'Stop schedule' : tick ? 'Start schedule' : isRunning ? 'Running…' : 'Run this AI node'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void run(node)}
              >
                {isRunning ? <span className="spin" /> : isDone ? '✓' : ticking ? '⏱' : '▶'}
              </button>
              <button
                className={`slate-lock-btn${locked ? ' locked' : ''}`}
                style={{ left: p.x - 15 * f - 26 * f, top: p.y - 11 * f, ['--f' as any]: f }}
                title={locked ? 'Reveal the prompt' : 'Hide the prompt (stays runnable, text shows a mask)'}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggleHiddenPrompt(ctl, node)}
              >
                {locked ? '🔒' : '🔓'}
              </button>
            </span>
          );
        })}
      </div>
    </>
  );
}

