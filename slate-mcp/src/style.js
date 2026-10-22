// Drawing-style param: schema fragment + authoritative enum check for
// create_board / add_objects / update_objects. Keep DRAW_STYLES in sync with
// src/engine/style.ts in the app (the tab re-validates).

export const DRAW_STYLES = ['sketch', 'handdrawn', 'messy'];

export const STYLE_DESCRIPTION =
  'Drawing style: "sketch" (rough, Excalidraw-like — the default), "handdrawn" or "messy".';

export const styleSchema = (description) => ({ type: 'string', enum: DRAW_STYLES, description });

const isStyle = (v) => DRAW_STYLES.includes(v);
const bad = (where, v) => `${where}: style must be one of ${DRAW_STYLES.join('|')} (got ${JSON.stringify(v)})`;

/**
 * Validate every `style` in a tool call's arguments. Returns null when fine, or
 * an error message. Absent style is always fine; update_objects also accepts
 * null (clear the override → board style).
 */
export function checkStyleArgs(name, args) {
  if (name === 'create_board') {
    if (args?.style !== undefined && !isStyle(args.style)) return bad('create_board', args.style);
  } else if (name === 'add_objects' && Array.isArray(args?.objects)) {
    for (let i = 0; i < args.objects.length; i++) {
      const v = args.objects[i]?.style;
      if (v !== undefined && !isStyle(v)) return bad(`objects[${i}]`, v);
    }
  } else if (name === 'update_objects' && Array.isArray(args?.edits)) {
    for (let i = 0; i < args.edits.length; i++) {
      const patch = args.edits[i]?.patch;
      if (patch && typeof patch === 'object' && 'style' in patch && patch.style !== null && !isStyle(patch.style)) {
        return bad(`edits[${i}].patch`, patch.style);
      }
    }
  }
  return null;
}
