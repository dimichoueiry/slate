import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { db, updateBoardMeta } from '../store/db';
import { useUI } from '../store/ui';

/**
 * Collapsible markdown notes for the current board (Eraser-style side panel).
 * Notes autosave to the board record, debounced.
 */
export default function NotesPanel({ boardId }: { boardId: string }) {
  const open = useUI((s) => s.notesOpen);
  const set = useUI((s) => s.set);
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    db.boards.get(boardId).then((b) => {
      if (!cancelled) setText(b?.notes ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  const save = (value: string) => {
    setText(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void updateBoardMeta(boardId, { notes: value }), 400);
  };

  // flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const html = useMemo(
    () => (text ? (marked.parse(text, { async: false, breaks: true }) as string) : ''),
    [text]
  );

  if (!open) return null;

  return (
    <div className="notes-panel">
      <div className="notes-header">
        <div className="seg">
          <button className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>
            Write
          </button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            Preview
          </button>
        </div>
        <button className="chrome-btn" title="Close notes" onClick={() => set({ notesOpen: false })}>
          ✕
        </button>
      </div>
      {mode === 'write' ? (
        <textarea
          className="notes-editor"
          placeholder={'# Notes\n\nMarkdown supported — headings, **bold**, lists, `code`…'}
          value={text ?? ''}
          spellCheck={false}
          onChange={(e) => save(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="notes-preview" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}
