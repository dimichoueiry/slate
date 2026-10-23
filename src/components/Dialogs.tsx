// In-app replacements for window.prompt / confirm / alert, plus toasts.
// Imperative, promise-based API so call sites stay one-liners:
//   const name = await promptDialog({ title: 'Rename board', initial: b.name });
//   if (await confirmDialog({ title: 'Delete forever?', danger: true })) …
//   toast('Moved to Trash', { action: { label: 'Undo', run: restore } });
// <DialogHost /> is mounted once in App. Dialogs are modal (focus trapped,
// Escape cancels, focus returns to where it was); toasts are polite live
// regions that never steal focus.
import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useToasts, dismissToast, type Toast } from '../store/toasts';

export { toast, dismissToast } from '../store/toasts';

interface DialogBase {
  id: number;
  title: string;
  body?: string;
}
type DialogReq =
  | (DialogBase & { kind: 'confirm'; confirmLabel: string; cancelLabel: string; danger: boolean; resolve: (ok: boolean) => void })
  | (DialogBase & { kind: 'prompt'; label?: string; initial: string; confirmLabel: string; resolve: (v: string | null) => void })
  | (DialogBase & { kind: 'alert'; resolve: () => void });

const useDialogs = create<{ stack: DialogReq[] }>(() => ({ stack: [] }));
let nextId = 1;

function push(d: DialogReq) {
  useDialogs.setState((s) => ({ stack: [...s.stack, d] }));
}
function pop(id: number) {
  useDialogs.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
}

export function confirmDialog(opts: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) =>
    push({
      kind: 'confirm',
      id: nextId++,
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: !!opts.danger,
      resolve,
    })
  );
}

/** Resolves to the trimmed text, or null when cancelled or left empty. */
export function promptDialog(opts: {
  title: string;
  body?: string;
  label?: string;
  initial?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) =>
    push({
      kind: 'prompt',
      id: nextId++,
      title: opts.title,
      body: opts.body,
      label: opts.label,
      initial: opts.initial ?? '',
      confirmLabel: opts.confirmLabel ?? 'Save',
      resolve,
    })
  );
}

export function alertDialog(opts: { title: string; body?: string }): Promise<void> {
  return new Promise((resolve) => push({ kind: 'alert', id: nextId++, title: opts.title, body: opts.body, resolve }));
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

function Dialog({ d }: { d: DialogReq }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(d.kind === 'prompt' ? d.initial : '');

  const close = (result: 'ok' | 'cancel') => {
    pop(d.id);
    if (d.kind === 'confirm') d.resolve(result === 'ok');
    else if (d.kind === 'prompt') d.resolve(result === 'ok' ? value.trim() || null : null);
    else d.resolve();
  };

  // focus in on open, back to the opener on close
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else {
      ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // keep board shortcuts (Delete, Escape…) out of the dialog
    if (e.key === 'Escape') {
      e.preventDefault();
      close('cancel');
    } else if (e.key === 'Tab') {
      // focus trap
      const els = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const titleId = `dlg-title-${d.id}`;
  const bodyId = `dlg-body-${d.id}`;
  return (
    <div className="dlg-scrim" onPointerDown={(e) => e.target === e.currentTarget && close('cancel')}>
      <div
        ref={ref}
        className="dlg"
        role={d.kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={d.body ? bodyId : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="dlg-title">
          {d.title}
        </h2>
        {d.body && (
          <p id={bodyId} className="dlg-body">
            {d.body}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            close('ok');
          }}
        >
          {d.kind === 'prompt' && (
            <label className="dlg-field">
              {d.label && <span>{d.label}</span>}
              <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
            </label>
          )}
          <div className="dlg-actions">
            {d.kind !== 'alert' && (
              <button type="button" className="chrome-btn" onClick={() => close('cancel')}>
                {d.kind === 'confirm' ? d.cancelLabel : 'Cancel'}
              </button>
            )}
            <button
              type="submit"
              className={`chrome-btn primary${d.kind === 'confirm' && d.danger ? ' danger' : ''}`}
              data-autofocus
            >
              {d.kind === 'alert' ? 'OK' : d.confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToastItem({ t }: { t: Toast }) {
  return (
    <div className="toast" role="status">
      <span className="toast-msg">{t.message}</span>
      {t.action && (
        <button
          className="toast-action"
          onClick={() => {
            dismissToast(t.id);
            void t.action!.run();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
        ✕
      </button>
    </div>
  );
}

export default function DialogHost() {
  const stack = useDialogs((s) => s.stack);
  const toasts = useToasts((s) => s.toasts);
  const top = stack[stack.length - 1];
  return (
    <>
      {/* newest on top: a dialog opened from a dialog stacks over it */}
      {top && <Dialog key={top.id} d={top} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </div>
    </>
  );
}
