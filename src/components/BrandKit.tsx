import { useEffect, useRef, useState } from 'react';
import type { Controller } from '../engine/controller';
import { useUI } from '../store/ui';
import { FONTS, PALETTE, type BrandKit } from '../types';
import {
  db,
  deleteBrandKit,
  getDefaultKitId,
  listBrandKits,
  putBlob,
  saveBrandKit,
  setDefaultKitId,
  updateBoardMeta,
} from '../store/db';
import { nanoid } from 'nanoid';

const CSS = `
.brand-pill{display:flex;align-items:center;gap:5px;border:none;background:rgba(255,255,255,.08);color:#e8e8ea;border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer;white-space:nowrap}
.brand-pill:hover{background:rgba(255,255,255,.16)}
.brand-pill .hex{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.brand-modal-bg{position:fixed;inset:0;z-index:130;background:rgba(10,10,14,.4);display:flex;align-items:flex-start;justify-content:center;padding-top:8vh}
.brand-modal{width:min(480px,94vw);max-height:84vh;overflow-y:auto;background:rgba(28,28,32,.97);color:#e8e8ea;border-radius:14px;padding:18px;box-shadow:0 8px 40px rgba(0,0,0,.4);font-size:13px}
.brand-modal h3{margin:0 0 12px;font-size:15px}
.brand-modal label{display:block;font-size:11.5px;color:#9a9aa2;margin:10px 0 3px}
.brand-modal input[type=text],.brand-modal textarea{width:100%;box-sizing:border-box;background:rgba(255,255,255,.07);border:none;border-radius:8px;color:#e8e8ea;padding:8px 10px;font-size:13px;outline:none;font-family:inherit}
.brand-modal textarea{resize:vertical;min-height:52px}
.brand-modal .swatches{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}
.brand-modal .sw{width:24px;height:24px;border-radius:6px;border:2px solid transparent;cursor:pointer;padding:0}
.brand-modal .sw.on{border-color:#fff;box-shadow:0 0 0 1.5px var(--accent)}
.brand-modal .row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.brand-modal button{border:none;border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;background:rgba(255,255,255,.08);color:#e8e8ea}
.brand-modal button.primary{background:#3c78ff;color:#fff}
.brand-modal button.danger{background:rgba(224,49,49,.25)}
.brand-logo{display:flex;align-items:center;gap:10px;margin-top:4px}
.brand-logo img{width:44px;height:44px;object-fit:contain;border-radius:8px;background:#fff}
.brand-menu{position:absolute;top:42px;background:rgba(28,28,32,.97);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:5px;z-index:50;min-width:200px}
.brand-menu button{display:flex;justify-content:space-between;width:100%;border:none;background:transparent;color:#e8e8ea;padding:7px 10px;font-size:12.5px;border-radius:7px;cursor:pointer;text-align:left}
.brand-menu button:hover{background:rgba(255,255,255,.1)}
.brand-menu .sep{height:1px;background:rgba(255,255,255,.1);margin:4px 6px}
.brand-menu .check{color:#7ce29a}
`;

function blankKit(): BrandKit {
  return { id: nanoid(10), name: 'New brand', voice: '', audience: '', donts: '', palette: [], fontFamily: 'sans', createdAt: Date.now() };
}

export default function BrandKitControl({ ctl, boardId }: { ctl: Controller; boardId: string }) {
  void ctl;
  const active = useUI((s) => s.activeBrandKit);
  const version = useUI((s) => s.brandKitsVersion);
  const set = useUI((s) => s.set);
  const [menu, setMenu] = useState(false);
  const [kits, setKits] = useState<BrandKit[]>([]);
  const [editing, setEditing] = useState<BrandKit | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listBrandKits().then(setKits);
  }, [version, menu]);

  const bump = () => set({ brandKitsVersion: useUI.getState().brandKitsVersion + 1 });

  const activate = async (kit: BrandKit | null) => {
    await updateBoardMeta(boardId, { brandKitId: kit ? kit.id : null });
    set({ activeBrandKit: kit });
    setMenu(false);
  };

  const saveEditing = async () => {
    if (!editing) return;
    await saveBrandKit(editing);
    if (active?.id === editing.id) set({ activeBrandKit: editing });
    setEditing(null);
    bump();
  };

  const onLogo = async (file: File | undefined) => {
    if (!file || !editing) return;
    const blobId = await putBlob(file);
    setEditing({ ...editing, logoBlobId: blobId });
  };

  return (
    <>
      <style>{CSS}</style>
      <div style={{ position: 'relative' }}>
        <button className="brand-pill" title="Brand kit applied to AI nodes on this board" onClick={() => setMenu((m) => !m)}>
          {active?.palette?.[0] && <span className="hex" style={{ background: active.palette[0] }} />}⬡ {active ? active.name : 'No brand'} ▾
        </button>
        {menu && (
          <div className="brand-menu" onPointerLeave={() => setMenu(false)}>
            <button onClick={() => void activate(null)}>
              No brand {!active && <span className="check">✓</span>}
            </button>
            <div className="sep" />
            {kits.map((k) => (
              <button key={k.id} onClick={() => void activate(k)}>
                {k.name} {active?.id === k.id && <span className="check">✓</span>}
              </button>
            ))}
            {kits.length > 0 && <div className="sep" />}
            {active && <button onClick={() => { setEditing({ ...active }); setMenu(false); }}>Edit “{active.name}”…</button>}
            <button
              onClick={() => {
                const k = blankKit();
                setEditing(k);
                setMenu(false);
              }}
            >
              ＋ New brand kit
            </button>
            {active && (
              <button onClick={() => { setDefaultKitId(active.id); setMenu(false); }}>
                Set as default for new boards
                {getDefaultKitId() === active.id && <span className="check">✓</span>}
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="brand-modal-bg" onPointerDown={() => setEditing(null)}>
          <div className="brand-modal" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <h3>Brand kit</h3>
            <label>Name</label>
            <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <label>Voice & tone</label>
            <textarea
              placeholder="e.g. confident but warm, plain language, short sentences, a little wit"
              value={editing.voice}
              onChange={(e) => setEditing({ ...editing, voice: e.target.value })}
            />
            <label>Audience</label>
            <input
              type="text"
              placeholder="e.g. early-stage B2B founders"
              value={editing.audience}
              onChange={(e) => setEditing({ ...editing, audience: e.target.value })}
            />
            <label>Avoid (don'ts)</label>
            <input
              type="text"
              placeholder="e.g. jargon, hype, emojis, exclamation marks"
              value={editing.donts}
              onChange={(e) => setEditing({ ...editing, donts: e.target.value })}
            />
            <label>Palette</label>
            <div className="swatches">
              {[...new Set([...PALETTE, ...editing.palette])].map((c) => {
                const on = editing.palette.includes(c);
                return (
                  <button
                    key={c}
                    className={`sw ${on ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        palette: on ? editing.palette.filter((x) => x !== c) : [...editing.palette, c],
                      })
                    }
                  />
                );
              })}
              <label className="sw" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px dashed #888', color: '#aaa' }} title="Add custom color">
                ＋
                <input
                  type="color"
                  style={{ position: 'absolute', opacity: 0, width: 24, height: 24, cursor: 'pointer' }}
                  onChange={(e) => setEditing({ ...editing, palette: [...editing.palette, e.target.value] })}
                />
              </label>
            </div>
            <label>Font</label>
            <select
              className="font-select"
              value={editing.fontFamily ?? 'sans'}
              onChange={(e) => setEditing({ ...editing, fontFamily: e.target.value })}
            >
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                  {f.label}
                </option>
              ))}
            </select>
            <label>Logo (used as reference for image nodes)</label>
            <div className="brand-logo">
              <LogoPreview blobId={editing.logoBlobId} />
              <button onClick={() => fileRef.current?.click()}>{editing.logoBlobId ? 'Replace' : 'Upload'}</button>
              {editing.logoBlobId && <button onClick={() => setEditing({ ...editing, logoBlobId: undefined })}>Remove</button>}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void onLogo(e.target.files?.[0])} />
            </div>

            <div className="row">
              <button
                className="danger"
                onClick={async () => {
                  if (confirm(`Delete brand kit “${editing.name}”?`)) {
                    await deleteBrandKit(editing.id);
                    if (active?.id === editing.id) void activate(null);
                    if (getDefaultKitId() === editing.id) setDefaultKitId(null);
                    setEditing(null);
                    bump();
                  }
                }}
              >
                Delete
              </button>
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button className="primary" onClick={() => void saveEditing()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LogoPreview({ blobId }: { blobId?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    if (blobId) {
      void db.blobs.get(blobId).then((row) => {
        if (row) {
          revoked = URL.createObjectURL(row.blob);
          setUrl(revoked);
        }
      });
    } else setUrl(null);
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [blobId]);
  return url ? <img src={url} alt="logo" /> : <span style={{ color: '#888', fontSize: 11 }}>none</span>;
}
