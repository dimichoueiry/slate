// Toast queue (no React): a message, an optional action (e.g. Undo), and an
// auto-dismiss timer. Rendered by <DialogHost />; kept separate so it's
// testable under node.
import { create } from 'zustand';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

export const UNDO_TOAST_MS = 6000;

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

export function toast(message: string, opts: { action?: ToastAction; durationMs?: number } = {}): number {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, message, action: opts.action }] }));
  timers.set(id, setTimeout(() => dismissToast(id), opts.durationMs ?? UNDO_TOAST_MS));
  return id;
}

export function dismissToast(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
