// Floating actions for a selected image object: download, copy to clipboard.
// Self-mounting; reads the blob from the store by blobId.
import { useEffect, useReducer, useState } from 'react';
import { useUI } from '../store/ui';
import type { Controller } from '../engine/controller';
import { getBlob } from '../store/db';

const CSS = `
.slate-img-actions{position:fixed;z-index:46;display:flex;gap:4px;background:var(--surface);border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,.28);backdrop-filter:blur(12px);padding:5px;pointer-events:auto}
.slate-img-actions button{border:none;background:var(--surface-2);color:var(--text);border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.slate-img-actions button:hover{background:var(--accent)}
.slate-img-actions .ok{background:#2f9e44}
`;

export default function ImageActions({ ctl }: { ctl: Controller }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selection = useUI((s) => s.selection);
  const editing = useUI((s) => s.editingTextId);
  useUI((s) => s.docVersion);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    const offCam = ctl.onCamera(force);
    return () => offCam?.();
  }, [ctl]);

  if (editing || selection.length !== 1) return null;
  const obj = ctl.doc.get(selection[0]);
  if (!obj || obj.type !== 'image' || !obj.blobId || String(obj.blobId).startsWith('pending-')) return null;

  // toolbar sits just above the image's top-left corner, in screen space
  const p = ctl.worldToScreenPt({ x: obj.x, y: obj.y });

  const filename = `slate-image-${Date.now()}.png`;

  const download = async () => {
    const blob = await getBlob(obj.blobId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    setFlash('Saved');
    setTimeout(() => setFlash(''), 1500);
  };

  const copy = async () => {
    try {
      const blob = await getBlob(obj.blobId);
      if (!blob) return;
      // clipboard wants image/png; convert if needed via a canvas
      let png = blob;
      if (blob.type !== 'image/png') {
        const bmp = await createImageBitmap(blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        png = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setFlash('Copied');
    } catch {
      setFlash('Copy blocked');
    }
    setTimeout(() => setFlash(''), 1500);
  };

  const openFull = async () => {
    const blob = await getBlob(obj.blobId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  return (
    <>
      <style>{CSS}</style>
      <div
        className="slate-img-actions"
        style={{ left: p.x, top: Math.max(8, p.y - 44) }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className={flash === 'Saved' ? 'ok' : ''} onClick={() => void download()}>
          {flash === 'Saved' ? '✓ Saved' : '↓ Download'}
        </button>
        <button className={flash.startsWith('Cop') ? 'ok' : ''} onClick={() => void copy()}>
          {flash === 'Copied' ? '✓ Copied' : flash === 'Copy blocked' ? '✗ Blocked' : '⧉ Copy'}
        </button>
        <button onClick={() => void openFull()}>↗ Full size</button>
      </div>
    </>
  );
}
