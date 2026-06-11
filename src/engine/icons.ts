// Iconland: the built-in icon library. Stroke-style icons on a 24×24 grid stored
// as SVG path data, so they render crisply at any zoom and export as real vectors.

export interface IconDef {
  id: string;
  label: string;
  tags: string;
  d: string[];
}

export interface IconCategory {
  id: string;
  label: string;
  icons: IconDef[];
}

// ---------- path helpers ----------

/** circle as path data */
const cir = (cx: number, cy: number, r: number) =>
  `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0`;

const pt = (cx: number, cy: number, r: number, a: number) =>
  `${+(cx + r * Math.cos(a)).toFixed(2)},${+(cy + r * Math.sin(a)).toFixed(2)}`;

/** regular polygon */
function poly(cx: number, cy: number, r: number, n: number, rot = -Math.PI / 2): string {
  let d = `M${pt(cx, cy, r, rot)}`;
  for (let i = 1; i < n; i++) d += ` L${pt(cx, cy, r, rot + (i * 2 * Math.PI) / n)}`;
  return d + ' Z';
}

/** star with n points */
function star(cx: number, cy: number, ro: number, ri: number, n: number, rot = -Math.PI / 2): string {
  let d = `M${pt(cx, cy, ro, rot)}`;
  for (let i = 1; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri;
    d += ` L${pt(cx, cy, r, rot + (i * Math.PI) / n)}`;
  }
  return d + ' Z';
}

/** n small circles arranged in a ring (rosettes, flowers) */
function rosette(cx: number, cy: number, ringR: number, dotR: number, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    out.push(cir(cx + ringR * Math.cos(a), cy + ringR * Math.sin(a), dotR));
  }
  return out;
}

const I = (id: string, label: string, tags: string, ...d: string[]): IconDef => ({ id, label, tags, d });

// ---------- the library ----------

export const ICON_CATEGORIES: IconCategory[] = [
  {
    id: 'arrows',
    label: 'Arrows',
    icons: [
      I('arrow-right', 'Arrow right', 'direction next', 'M3 12 H21', 'M14.5 5.5 L21 12 L14.5 18.5'),
      I('arrow-left', 'Arrow left', 'direction back previous', 'M21 12 H3', 'M9.5 5.5 L3 12 L9.5 18.5'),
      I('arrow-up', 'Arrow up', 'direction top', 'M12 21 V3', 'M5.5 9.5 L12 3 L18.5 9.5'),
      I('arrow-down', 'Arrow down', 'direction bottom', 'M12 3 V21', 'M5.5 14.5 L12 21 L18.5 14.5'),
      I('arrow-up-right', 'Arrow up right', 'diagonal external', 'M5 19 L19 5', 'M9 5 H19 V15'),
      I('arrow-down-right', 'Arrow down right', 'diagonal', 'M5 5 L19 19', 'M19 9 V19 H9'),
      I('chevron-right', 'Chevron right', 'next caret', 'M9 5 L16 12 L9 19'),
      I('chevron-left', 'Chevron left', 'back caret', 'M15 5 L8 12 L15 19'),
      I('chevrons-right', 'Chevrons', 'fast forward double', 'M6 5 L13 12 L6 19', 'M12 5 L19 12 L12 19'),
      I('refresh', 'Refresh', 'reload sync rotate', 'M3 12 a9 9 0 0 1 9 -9 a9.7 9.7 0 0 1 6.7 2.7 L21 8', 'M21 3 v5 h-5', 'M21 12 a9 9 0 0 1 -9 9 a9.7 9.7 0 0 1 -6.7 -2.7 L3 16', 'M8 16 H3 v5'),
      I('undo', 'Undo', 'back revert history', 'M9 14 L4 9 L9 4', 'M4 9 H14.5 a5.5 5.5 0 0 1 0 11 H11'),
      I('redo', 'Redo', 'forward repeat history', 'M15 14 L20 9 L15 4', 'M20 9 H9.5 a5.5 5.5 0 0 0 0 11 H13'),
      I('expand', 'Expand', 'fullscreen maximize', 'M3 9 V3 H9', 'M15 3 H21 V9', 'M21 15 V21 H15', 'M9 21 H3 V15'),
      I('collapse', 'Collapse', 'minimize exit fullscreen', 'M9 3 V9 H3', 'M15 3 V9 H21', 'M21 15 H15 V21', 'M3 15 H9 V21'),
      I('shuffle', 'Shuffle', 'random mix', 'M3 6 H6.5 L17 18 H21', 'M18.5 15.5 L21 18 L18.5 20.5', 'M3 18 H6.5 L9.7 14.3', 'M14 9.5 L17 6 H21', 'M18.5 3.5 L21 6 L18.5 8.5'),
      I('move', 'Move', 'drag pan all directions', 'M12 2 V22', 'M2 12 H22', 'M9 5 L12 2 L15 5', 'M9 19 L12 22 L15 19', 'M5 9 L2 12 L5 15', 'M19 9 L22 12 L19 15'),
    ],
  },
  {
    id: 'ui',
    label: 'UI & Web',
    icons: [
      I('home', 'Home', 'house main start', 'M4 11 L12 3.5 L20 11 V20.5 H14.5 V15 H9.5 V20.5 H4 Z'),
      I('menu', 'Menu', 'hamburger nav', 'M4 7 H20', 'M4 12 H20', 'M4 17 H20'),
      I('dots', 'More', 'ellipsis options', cir(5, 12, 1.3), cir(12, 12, 1.3), cir(19, 12, 1.3)),
      I('plus', 'Plus', 'add new create', 'M12 5 V19', 'M5 12 H19'),
      I('minus', 'Minus', 'remove subtract', 'M5 12 H19'),
      I('close', 'Close', 'x cancel dismiss', 'M6 6 L18 18', 'M18 6 L6 18'),
      I('checkmark', 'Check', 'done yes confirm', 'M4.5 12.5 L10 18 L19.5 7'),
      I('download', 'Download', 'save get', 'M12 3 V15', 'M7 10.5 L12 15.5 L17 10.5', 'M4 20 H20'),
      I('upload', 'Upload', 'send put', 'M12 16 V4', 'M7 8.5 L12 3.5 L17 8.5', 'M4 20 H20'),
      I('share', 'Share', 'social send nodes', cir(6, 12, 2.6), cir(17.5, 5.5, 2.6), cir(17.5, 18.5, 2.6), 'M8.4 10.8 L15.2 6.8', 'M8.4 13.2 L15.2 17.2'),
      I('external', 'External link', 'open new tab', 'M14 4 H20 V10', 'M20 4 L11 13', 'M19 14 V20 H4 V5 H10'),
      I('trash', 'Trash', 'delete remove bin', 'M4 7 H20', 'M9.5 7 V4.5 H14.5 V7', 'M6 7 L7 20.5 H17 L18 7', 'M10 11 V16.5', 'M14 11 V16.5'),
      I('copy', 'Copy', 'duplicate clone', 'M8 8 h12 v12 h-12 Z', 'M16 8 V4 H4 V16 H8'),
      I('clipboard', 'Clipboard', 'paste tasks', 'M5 4.5 h14 V21.5 H5 Z', 'M9 2.5 h6 V6 H9 Z', 'M9 11 H15', 'M9 15 H15'),
      I('filter', 'Filter', 'funnel sort refine', 'M3 5 H21 L14.5 12.5 V19 L9.5 21.5 V12.5 Z'),
      I('sliders', 'Sliders', 'settings adjust controls', 'M4 6.5 H20', cir(9, 6.5, 1.8), 'M4 12 H20', cir(15, 12, 1.8), 'M4 17.5 H20', cir(7, 17.5, 1.8)),
      I('toggle', 'Toggle', 'switch on off', 'M7 8 h10 a4 4 0 0 1 0 8 H7 a4 4 0 0 1 0 -8 Z', cir(16, 12, 2.4)),
      I('bookmark', 'Bookmark', 'save favorite', 'M6.5 3.5 H17.5 V21 L12 16.5 L6.5 21 Z'),
      I('tag', 'Tag', 'label category price', 'M3.5 3.5 H11 L20.5 13 L13 20.5 L3.5 11 Z', cir(8, 8, 1.3)),
      I('paperclip', 'Attachment', 'clip attach file', 'M8 12.5 L15.5 5 a3.5 3.5 0 0 1 5 5 L10 20.5 a5 5 0 0 1 -7 -7 L12.5 4'),
      I('zoom-in', 'Zoom in', 'magnify plus', cir(10.5, 10.5, 6.5), 'M15.5 15.5 L21 21', 'M10.5 8 V13', 'M8 10.5 H13'),
      I('zoom-out', 'Zoom out', 'magnify minus', cir(10.5, 10.5, 6.5), 'M15.5 15.5 L21 21', 'M8 10.5 H13'),
      I('logout', 'Log out', 'exit sign out door', 'M9 4 H4.5 V20 H9', 'M13 12 H21', 'M17.5 8.5 L21 12 L17.5 15.5'),
      I('pushpin', 'Pin', 'stick attach hold', 'M9 3 H15 L14 9.5 L16.5 12.5 H7.5 L10 9.5 Z', 'M12 12.5 V21'),
      I('inbox', 'Inbox', 'tray messages received', 'M3 13 H8 L9.5 15.5 H14.5 L16 13 H21', 'M3 13 V19 H21 V13', 'M3 13 L5.5 5 H18.5 L21 13'),
      I('eye-off', 'Hidden', 'invisible private eye', 'M2 12 C6 5 18 5 22 12 C20.5 14.6 18.3 16.4 16 17.4', 'M9 16.9 C6.4 16 4 14.4 2 12', 'M4 4 L20 20', cir(12, 12, 3)),
    ],
  },
  {
    id: 'design',
    label: 'Design',
    icons: [
      I('cursor', 'Cursor', 'pointer select arrow', 'M5 3 L19 12 L12 13.5 L9 20 Z'),
      I('pen', 'Pen', 'edit write draw', 'M3 21 L5 15 L17 3 L21 7 L9 19 Z', 'M14.5 5.5 L18.5 9.5'),
      I('brush', 'Brush', 'paint art stroke', 'M9.5 14.5 C4 14 3 17.5 3 21 c3.5 0 7-1 6.5-6.5 Z', 'M9.5 14.5 L18.5 3.5 C19.5 2.5 21.5 4.5 20.5 5.5 L9.5 14.5'),
      I('eyedropper', 'Eyedropper', 'color picker sample', 'M11 7 L17 13 L8.5 21.5 H4.5 A2 2 0 0 1 2.5 19.5 V15.5 Z', 'M9 9 L13.5 4.5 a2.8 2.8 0 0 1 4 0 l2 2 a2.8 2.8 0 0 1 0 4 L15 15'),
      I('layers', 'Layers', 'stack copies', 'M12 3 L21 8 L12 13 L3 8 Z', 'M3 12 L12 17 L21 12', 'M3 16 L12 21 L21 16'),
      I('eye', 'Eye', 'view visibility review', 'M2 12 C6 5 18 5 22 12 C18 19 6 19 2 12 Z', cir(12, 12, 3)),
      I('image', 'Image', 'photo picture media', 'M3 5 h18 v14 h-18 Z', cir(8.5, 10, 1.6), 'M3 17 L9 12 L13 15 L16.5 12 L21 16'),
      I('type', 'Text', 'typography font letter', 'M5 5 H19', 'M12 5 V19', 'M8.5 19 H15.5'),
      I('crop', 'Crop', 'cut trim resize', 'M7 3 V17 H21', 'M3 7 H17 V21'),
      I('grid', 'Grid', 'layout table', 'M4 4 h16 v16 h-16 Z', 'M10 4 V20', 'M16 4 V20', 'M4 10 H20', 'M4 16 H20'),
      I('ruler', 'Ruler', 'measure size', 'M3 17 L17 3 L21 7 L7 21 Z', 'M8.5 15.5 l1.8 1.8', 'M11.5 12.5 l1.8 1.8', 'M14.5 9.5 l1.8 1.8'),
      I('palette', 'Palette', 'color paint art', 'M12 3 a9 9 0 1 0 0 18 c1.6 0 2.1 -1.1 1.5 -2.2 c-.7 -1.4 .3 -2.8 1.9 -2.8 H17.5 A3.5 3.5 0 0 0 21 12.5 A9 9 0 0 0 12 3 Z', cir(7.5, 10.5, 1), cir(10.5, 7, 1), cir(14.5, 7, 1), cir(17, 10.5, 1)),
      I('bezier', 'Bezier', 'curve vector path', 'M4 18 C4 10 9 6 20 6', cir(4, 18, 1.8), cir(20, 6, 1.8), 'M10.2 2.7 h3.6 v3.6 h-3.6 Z', 'M12 6.3 V10.6'),
      I('frame-tool', 'Frame', 'artboard crop bounds', 'M6 2.5 V21.5', 'M18 2.5 V21.5', 'M2.5 6 H21.5', 'M2.5 18 H21.5'),
      I('swatch', 'Swatches', 'color samples cards', 'M3.5 3.5 h7 V17 a3.5 3.5 0 0 1 -7 0 Z', cir(7, 16.8, 1), 'M10.5 9.5 L14 6 L20.5 12.5 L12.8 20.2', 'M13 20.5 H20.5 V13'),
      I('magic', 'Magic wand', 'sparkle effect auto', 'M5 19 L15 9', 'M13 7 L17 11', star(18.5, 4.5, 2.8, 1.1, 4), star(5.5, 7.5, 2.2, 0.9, 4), star(19.5, 17.5, 2.2, 0.9, 4)),
    ],
  },
  {
    id: 'dev',
    label: 'Engineering',
    icons: [
      I('server', 'Server', 'backend infra host', 'M3 4 h18 v7 h-18 Z', 'M3 13 h18 v7 h-18 Z', cir(7, 7.5, 0.9), cir(7, 16.5, 0.9)),
      I('database', 'Database', 'db storage sql data', 'M4 6 a8 3 0 1 0 16 0 a8 3 0 1 0 -16 0', 'M4 6 V18 a8 3 0 0 0 16 0 V6', 'M4 12 a8 3 0 0 0 16 0'),
      I('cloud', 'Cloud', 'aws hosting infra', 'M7 18.5 a4.5 4.5 0 1 1 .9 -8.9 A6 6 0 0 1 19 11.5 a3.5 3.5 0 0 1 -1 7 Z'),
      I('cloud-up', 'Cloud upload', 'deploy push', 'M7 17.5 a4.5 4.5 0 1 1 .9 -8.9 A6 6 0 0 1 19 10.5 a3.5 3.5 0 0 1 -1 7', 'M12 12.5 V21', 'M8.8 15.2 L12 12 L15.2 15.2'),
      I('cpu', 'Chip', 'processor hardware ai', 'M6 6 h12 v12 h-12 Z', 'M10 10 h4 v4 h-4 Z', 'M9 3 V6', 'M15 3 V6', 'M9 18 V21', 'M15 18 V21', 'M3 9 H6', 'M3 15 H6', 'M18 9 H21', 'M18 15 H21'),
      I('terminal', 'Terminal', 'cli shell console', 'M3 4 h18 v16 h-18 Z', 'M7 9 L10 12 L7 15', 'M12 15.5 H17'),
      I('code', 'Code', 'developer brackets programming', 'M8 6 L3 12 L8 18', 'M16 6 L21 12 L16 18'),
      I('branch', 'Git branch', 'version merge fork', cir(6, 6, 2.2), cir(6, 18, 2.2), cir(18, 7, 2.2), 'M6 8.2 V15.8', 'M18 9.2 C18 13.5 13 15.5 8.5 16'),
      I('commit', 'Commit', 'git node point', cir(12, 12, 3.5), 'M2.5 12 H8.5', 'M15.5 12 H21.5'),
      I('container', 'Container', 'docker box deploy', 'M3.5 8.5 L12 4 L20.5 8.5 V15.5 L12 20 L3.5 15.5 Z', 'M3.5 8.5 L12 13 L20.5 8.5', 'M12 13 V20', 'M7.7 6.3 L16.3 10.8'),
      I('webhook', 'Webhook', 'event callback api', cir(6, 17, 3.2), cir(18, 17, 3.2), cir(12, 6.5, 3.2), 'M10.4 9.2 L7 15', 'M13.6 9.2 L16 13.9', 'M9 17 H15'),
      I('function', 'Function', 'lambda fx math', 'M9 4 c2.5 0 3.5 1.5 3.2 4 L10.5 16 c-.3 2.5 -1.3 4 -3.8 4', 'M5.5 9.5 H13.5', 'M15 12 L20.5 19', 'M20.5 12 L15 19'),
      I('binary', 'Binary', 'bits data 01', 'M5 4 h4 v6 H5 Z', 'M15 14 h4 v6 h-4 Z', 'M16.5 4 V10', 'M15 10 H19', 'M6.5 14 V20', 'M5 20 H9'),
      I('robot', 'Robot', 'ai bot automation', 'M5 9 h14 v11 H5 Z', 'M12 9 V5', cir(12, 4, 1.2), cir(9, 13.5, 1), cir(15, 13.5, 1), 'M9.5 17 H14.5', 'M5 12 H2.5 V16 H5', 'M19 12 H21.5 V16 H19'),
      I('antenna', 'Antenna', 'signal broadcast radio', 'M12 11 V21', cir(12, 9.5, 1.6), 'M7.5 5 a6.5 6.5 0 0 0 0 9', 'M16.5 5 a6.5 6.5 0 0 1 0 9', 'M5 2.5 a10 10 0 0 0 0 14', 'M19 2.5 a10 10 0 0 1 0 14'),
      I('settings', 'Settings', 'gear config preferences', cir(12, 12, 3.2), cir(12, 12, 7.2), 'M12 2.5 V4.8', 'M12 19.2 V21.5', 'M2.5 12 H4.8', 'M19.2 12 H21.5', 'M5.3 5.3 L6.9 6.9', 'M17.1 17.1 L18.7 18.7', 'M18.7 5.3 L17.1 6.9', 'M6.9 17.1 L5.3 18.7'),
      I('wrench', 'Wrench', 'tool fix maintenance', 'M20.5 6.5 a5 5 0 0 1 -6.6 6 L8 18.4 a2.2 2.2 0 0 1 -3.1 -3.1 L10.8 9.4 a5 5 0 0 1 6 -6.6 L13.5 6 l3.8 3.8 Z'),
      I('bug', 'Bug', 'issue defect error qa', 'M12 8 a4.2 4.2 0 0 1 4.2 4.2 V15 a4.2 4.2 0 0 1 -8.4 0 v-2.8 A4.2 4.2 0 0 1 12 8 Z', 'M9 8.5 a3 3 0 0 1 6 0', 'M7.8 12 H4', 'M7.8 15.5 H5', 'M16.2 12 H20', 'M16.2 15.5 H19', 'M10 6.5 L8.3 4.5', 'M14 6.5 L15.7 4.5'),
      I('lock', 'Lock', 'security private auth', 'M5 11 h14 v9 h-14 Z', 'M8 11 V8 a4 4 0 0 1 8 0 V11'),
      I('unlock', 'Unlock', 'open access', 'M5 11 h14 v9 h-14 Z', 'M8 11 V8 a4 4 0 0 1 7.8 -1.3'),
      I('key', 'Key', 'access auth password', cir(7.5, 15.5, 3.8), 'M10.5 12.5 L21 2', 'M16.5 6.5 l3 3', 'M13.5 9.5 l2 2'),
      I('shield', 'Shield', 'security protection safety', 'M12 3 L20 6 V11 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 11 V6 Z'),
      I('globe', 'Globe', 'web world internet', cir(12, 12, 9), 'M3 12 H21', 'M12 3 c4 4.5 4 13.5 0 18', 'M12 3 c-4 4.5 -4 13.5 0 18'),
      I('plug', 'API plug', 'integration connect', 'M9 3 V8', 'M15 3 V8', 'M7 8 H17 V11 a5 5 0 0 1 -10 0 Z', 'M12 16 V21'),
      I('package', 'Package', 'box module ship', 'M12 3 L21 7.5 V16.5 L12 21 L3 16.5 V7.5 Z', 'M3 7.5 L12 12 L21 7.5', 'M12 12 V21', 'M7.5 5.3 L16.5 9.8'),
      I('link', 'Link', 'url chain connect', 'M9.5 14.5 L14.5 9.5', 'M8 12.5 L5.8 14.7 a3.4 3.4 0 0 0 4.8 4.8 L12.8 17.3', 'M16 11.5 l2.2 -2.2 a3.4 3.4 0 0 0 -4.8 -4.8 L11.2 6.7'),
      I('wifi', 'Signal', 'wifi network connection', 'M2.5 9.5 a14 14 0 0 1 19 0', 'M5.5 13 a9.5 9.5 0 0 1 13 0', 'M8.5 16.2 a5 5 0 0 1 7 0', cir(12, 19.2, 1)),
      I('drive', 'Drive', 'disk storage hardware', 'M3 8 h18 v8 h-18 Z', cir(17.5, 12, 1), 'M3 8 L6 4 h12 l3 4'),
    ],
  },
  {
    id: 'ai',
    label: 'AI & ML',
    icons: [
      I('neural-net', 'Neural network', 'ai ml deep learning layers nodes',
        cir(4.5, 6, 1.8), cir(4.5, 12, 1.8), cir(4.5, 18, 1.8), cir(12, 9, 1.8), cir(12, 15, 1.8), cir(19.5, 12, 1.8),
        'M6.45 6.78 L10.05 8.22', 'M6.45 11.22 L10.05 9.78', 'M6.45 12.78 L10.05 14.22', 'M6.45 17.22 L10.05 15.78',
        'M13.95 9.78 L17.55 11.22', 'M13.95 14.22 L17.55 12.78'),
      I('brain-circuit', 'Deep learning', 'ai brain circuit neural mind',
        'M11.5 3.5 A3 3 0 0 0 8.4 6.4 A3.2 3.2 0 0 0 5.8 11.3 A3.4 3.4 0 0 0 6.3 17 A3 3 0 0 0 11.5 18.5 Z',
        'M11.5 8 H15.5', cir(17, 8, 1.2), 'M11.5 12 H14', cir(15.5, 12, 1.2), 'M11.5 16 H15.5', cir(17, 16, 1.2)),
      I('computer-vision', 'Computer vision', 'ai eye detect image recognition',
        'M3.5 7 V3.5 H7', 'M17 3.5 H20.5 V7', 'M20.5 17 V20.5 H17', 'M7 20.5 H3.5 V17',
        'M5.5 12 C8.5 8.5 15.5 8.5 18.5 12 C15.5 15.5 8.5 15.5 5.5 12 Z', cir(12, 12, 1.8)),
      I('object-detection', 'Object detection', 'ai bounding box vision detect',
        'M4 8 V4 H8', 'M16 4 H20 V8', 'M20 16 V20 H16', 'M8 20 H4 V16', cir(12, 12, 3.2)),
      I('face-id', 'Face recognition', 'ai face identity biometric',
        'M3.5 7 V3.5 H7', 'M17 3.5 H20.5 V7', 'M20.5 17 V20.5 H17', 'M7 20.5 H3.5 V17',
        cir(9.5, 10, 0.7), cir(14.5, 10, 0.7), 'M9.5 14.5 a3.5 3.5 0 0 0 5 0'),
      I('sparkles', 'Gen AI', 'ai sparkle magic generate llm',
        star(10, 12.5, 6.2, 2.3, 4), star(18.5, 5.5, 2.6, 1, 4), star(18, 17.5, 2.1, 0.8, 4)),
      I('chat-ai', 'AI chat', 'llm assistant bot conversation',
        'M5.5 4.5 h13 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 H10 L5 20.5 V6.5 a2 2 0 0 1 .5 -2 Z',
        star(13.5, 10.5, 2.8, 1.1, 4), star(8.8, 8.8, 1.7, 0.65, 4)),
      I('training', 'Training', 'ai loss curve learning gradient',
        'M4 4 V20 H20', 'M6 6.5 C9 15.5 13 17.5 19 18'),
      I('gpu', 'GPU', 'graphics cuda compute hardware',
        'M2.5 7 h19 v10 h-19 Z', cir(8.5, 12, 2.8), cir(15.5, 12, 2.8), cir(8.5, 12, 0.6), cir(15.5, 12, 0.6), 'M4.5 17 V19.5 H13'),
      I('matrix', 'Matrix', 'tensor math grid linear algebra',
        'M7 4 H4.5 V20 H7', 'M17 4 H19.5 V20 H17',
        cir(9.7, 8, 0.9), cir(14.3, 8, 0.9), cir(9.7, 12, 0.9), cir(14.3, 12, 0.9), cir(9.7, 16, 0.9), cir(14.3, 16, 0.9)),
      I('vectors', 'Embeddings', 'vector space ai latent',
        'M4.5 3.5 V19.5 H20.5', 'M4.5 19.5 L14 8', 'M11.6 8.4 L14 8 L13.6 10.4', 'M4.5 19.5 L18 13.5', 'M15.7 12.7 L18 13.5 L16.7 15.5'),
      I('cluster', 'Clustering', 'ai groups kmeans segments',
        cir(8, 7.5, 3.6), cir(6.8, 6.8, 0.8), cir(9.3, 7, 0.8), cir(8, 9, 0.8),
        cir(16.8, 9, 3.2), cir(15.8, 8.2, 0.8), cir(17.8, 9.8, 0.8),
        cir(11.5, 17, 3.4), cir(10.4, 16.4, 0.8), cir(12.7, 16.6, 0.8), cir(11.5, 18.4, 0.8)),
      I('decision-tree', 'Decision tree', 'ai classifier branches model',
        cir(12, 4.8, 2), 'M12 6.8 V9.5', 'M6.5 9.5 H17.5', 'M6.5 9.5 V12', 'M17.5 9.5 V12',
        cir(6.5, 13.8, 1.8), cir(17.5, 13.8, 1.8), 'M6.5 15.6 V17.2', 'M17.5 15.6 V17.2', cir(6.5, 18.7, 1.4), cir(17.5, 18.7, 1.4)),
      I('regression', 'Regression', 'ai fit line prediction model',
        'M4 4 V20 H20', cir(8, 15, 0.9), cir(11, 12.5, 0.9), cir(14, 11, 0.9), cir(17, 8.5, 0.9), 'M6 17 L19 7'),
      I('waveform', 'Speech AI', 'voice audio waveform recognition',
        'M4 10 V14', 'M7.5 7 V17', 'M11 4.5 V19.5', 'M14.5 8 V16', 'M18 10.5 V13.5'),
      I('pipeline', 'Pipeline', 'ai workflow stages mlops',
        cir(4.8, 12, 2), 'M7 12 H10', 'M9 10.9 L10.3 12 L9 13.1', cir(12.5, 12, 2), 'M14.7 12 H17.7', 'M16.7 10.9 L18 12 L16.7 13.1', cir(20, 12, 1.8)),
    ],
  },
  {
    id: 'data',
    label: 'Data & Charts',
    icons: [
      I('chart', 'Bar chart', 'metrics analytics kpi', 'M4 4 V20 H20', 'M8.5 20 V12', 'M13 20 V7', 'M17.5 20 V15'),
      I('trend', 'Trend up', 'growth line metrics', 'M3 17 L9 11 L13 14 L21 6', 'M16 6 H21 V11'),
      I('trend-down', 'Trend down', 'decline drop loss', 'M3 7 L9 13 L13 10 L21 18', 'M16 18 H21 V13'),
      I('pie', 'Pie chart', 'share split portion', cir(12, 12, 9), 'M12 12 V3', 'M12 12 L19.8 16.5'),
      I('scatter', 'Scatter plot', 'points distribution', 'M4 4 V20 H20', cir(8.5, 15, 1.3), cir(11.5, 9.5, 1.3), cir(15, 13, 1.3), cir(17.5, 7, 1.3)),
      I('table', 'Table', 'spreadsheet rows columns', 'M3.5 4.5 h17 v15 h-17 Z', 'M3.5 9.5 H20.5', 'M3.5 14.5 H20.5', 'M10 4.5 V19.5', 'M15.5 4.5 V19.5'),
      I('funnel-chart', 'Funnel', 'conversion stages pipeline', 'M4 5 H20', 'M6.5 10 H17.5', 'M9 15 H15', 'M10.8 20 H13.2'),
      I('gauge', 'Gauge', 'speed meter dashboard', 'M4.5 18 A9 9 0 1 1 19.5 18', 'M12 13.5 L16.5 8', cir(12, 14.5, 1.4)),
      I('percent-chart', 'Percent', 'ratio rate', 'M5 19 L19 5', cir(7, 7, 2.6), cir(17, 17, 2.6)),
      I('activity', 'Activity', 'pulse monitor health', 'M3 12 H7 L10 5 L14 19 L17 12 H21'),
    ],
  },
  {
    id: 'product',
    label: 'Product & PRD',
    icons: [
      I('user', 'User', 'person profile persona', cir(12, 8, 4), 'M4 20 a8 8 0 0 1 16 0'),
      I('users', 'Team', 'people group collaboration', cir(9, 8.5, 3.5), 'M2.5 19.5 a6.5 6.5 0 0 1 13 0', cir(17, 9.5, 2.8), 'M16.5 19.5 a5.5 5.5 0 0 1 5 -4.5'),
      I('user-plus', 'Add user', 'invite new member', cir(10, 8, 4), 'M2.5 20 a7.5 7.5 0 0 1 15 0', 'M19 8 V14', 'M16 11 H22'),
      I('target', 'Target', 'goal aim objective okr', cir(12, 12, 9), cir(12, 12, 5.5), cir(12, 12, 2)),
      I('flag', 'Flag', 'milestone marker priority', 'M5 21 V4', 'M5 4.5 C9 2.5 12 6.5 19 5 V13 C12 14.5 9 10.5 5 12.5'),
      I('star', 'Star', 'favorite rating important', star(12, 12, 9.3, 4.4, 5)),
      I('heart', 'Heart', 'love like favorite', 'M12 20.5 C5 15 3 11.5 3 8.5 a4.5 4.5 0 0 1 9 -1.5 a4.5 4.5 0 0 1 9 1.5 c0 3 -2 6.5 -9 12 Z'),
      I('check-circle', 'Done', 'complete success approve', cir(12, 12, 9), 'M8 12.5 L11 15.5 L16.5 9'),
      I('x-circle', 'Blocked', 'cancel fail reject', cir(12, 12, 9), 'M9 9 L15 15', 'M15 9 L9 15'),
      I('warning', 'Warning', 'alert risk caution', 'M12 3.5 L22 20 H2 Z', 'M12 9.5 V14.5', cir(12, 17.3, 0.5)),
      I('info', 'Info', 'information note help', cir(12, 12, 9), 'M12 11 V16.5', cir(12, 7.8, 0.5)),
      I('bulb', 'Idea', 'lightbulb insight innovation', 'M9.3 16.5 a6.5 6.5 0 1 1 5.4 0 c-.5 .5 -.7 1.2 -.8 2 h-3.8 c-.1 -.8 -.3 -1.5 -.8 -2 Z', 'M10 21.5 h4'),
      I('rocket', 'Launch', 'ship startup release', 'M12 2.5 C15.5 4.5 17 8 16.5 12 L19 15 L16 16 C15 18.5 13.5 20 12 21 C10.5 20 9 18.5 8 16 L5 15 L7.5 12 C7 8 8.5 4.5 12 2.5 Z', cir(12, 9, 1.8)),
      I('calendar', 'Calendar', 'date schedule deadline', 'M3 5 h18 v16 h-18 Z', 'M3 10 H21', 'M8 3 V7', 'M16 3 V7'),
      I('doc', 'Document', 'file page spec prd', 'M6 2.5 h8 l5 5 v14 h-13 Z', 'M14 2.5 V7.5 H19', 'M9 12.5 H16', 'M9 16 H16'),
      I('kanban', 'Kanban', 'board tasks agile sprint', 'M4 4.5 h4.5 v12 H4 Z', 'M9.8 4.5 h4.5 v8 H9.8 Z', 'M15.5 4.5 H20 v15 h-4.5 Z'),
      I('roadmap', 'Roadmap', 'timeline plan milestones', 'M3 6 H13', cir(16, 6, 2), 'M3 12 H8', cir(11, 12, 2), 'M3 18 H16', cir(19, 18, 2)),
      I('bell', 'Bell', 'notification alert reminder', 'M6 16 V11 a6 6 0 0 1 12 0 v5 l1.5 2.5 H4.5 Z', 'M10 21 a2 2 0 0 0 4 0'),
      I('search', 'Search', 'find magnifier research', cir(10.5, 10.5, 6.5), 'M15.5 15.5 L21 21'),
      I('dollar', 'Revenue', 'money price cost pricing', 'M12 3.5 V20.5', 'M16.5 7 a4 4 0 0 0 -4 -2 h-1 a3.5 3.5 0 0 0 0 7 h1.5 a3.5 3.5 0 0 1 0 7 h-1.5 a4 4 0 0 1 -4 -2'),
      I('trophy', 'Trophy', 'win success achievement', 'M7 4 H17 V9 a5 5 0 0 1 -10 0 Z', 'M7 5.5 H4 V7 a3 3 0 0 0 3 3', 'M17 5.5 H20 V7 a3 3 0 0 1 -3 3', 'M12 14 V18', 'M8.5 18 H15.5 V21 H8.5 Z'),
      I('stack', 'Queue', 'list backlog items', 'M4 6 H20', 'M4 12 H20', 'M4 18 H13'),
    ],
  },
  {
    id: 'comm',
    label: 'Communication',
    icons: [
      I('mail', 'Mail', 'email message inbox', 'M3 5.5 h18 v13 h-18 Z', 'M3.5 7 L12 13 L20.5 7'),
      I('chat', 'Chat', 'message comment feedback', 'M5.5 4.5 h13 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 H10 L5 20.5 V6.5 a2 2 0 0 1 .5 -2 Z', 'M9 9.5 H15.5', 'M9 12.5 H13.5'),
      I('send', 'Send', 'paper plane deliver', 'M21 3 L3 10.5 L10.5 13.5 L13.5 21 Z', 'M21 3 L10.5 13.5'),
      I('megaphone', 'Announce', 'megaphone marketing launch', 'M3 10.5 L17 5 V19.5 L3 14 Z', 'M19.5 9.5 a3.5 3.5 0 0 1 0 5.5', 'M7.5 14.8 L9 20 H12 L10.5 14.5'),
      I('mic', 'Microphone', 'voice audio record', 'M9.5 5.5 a2.5 2.5 0 0 1 5 0 V11.5 a2.5 2.5 0 0 1 -5 0 Z', 'M6 11.5 a6 6 0 0 0 12 0', 'M12 17.5 V21', 'M9 21 H15'),
      I('video', 'Video', 'camera call record', 'M3 6 h13 v12 H3 Z', 'M16 10.5 L21 7.5 V16.5 L16 13.5'),
      I('headphones', 'Headphones', 'audio support listen', 'M4 18 V13.5 a8 8 0 0 1 16 0 V18', 'M4 14 h3.5 v6 H4 Z', 'M16.5 14 H20 v6 h-3.5 Z'),
      I('phone', 'Phone', 'call contact', 'M7 3.5 h3.5 l1.2 4.5 -2.2 1.6 a11.5 11.5 0 0 0 5 5 l1.6 -2.2 4.4 1.2 V17 a2 2 0 0 1 -2 2 A15.5 15.5 0 0 1 5 5.5 a2 2 0 0 1 2 -2 Z'),
      I('translate', 'Translate', 'language i18n localize', 'M3 5.5 H13', 'M8 3 V5.5', 'M11 5.5 C10.5 10 7.5 13.5 3.5 15.5', 'M5.5 9.5 C7 12.5 10 15 13 16', 'M12.5 21 L17.5 9.5 L22.5 21', 'M14.3 17.5 H20.7'),
    ],
  },
  {
    id: 'media',
    label: 'Media',
    icons: [
      I('play', 'Play', 'start video music', 'M8 5 L19 12 L8 19 Z'),
      I('pause', 'Pause', 'stop hold wait', 'M8 5 V19', 'M16 5 V19'),
      I('stop', 'Stop', 'end halt', 'M6.5 6.5 h11 v11 h-11 Z'),
      I('forward', 'Fast forward', 'skip next speed', 'M4.5 5.5 L12 12 L4.5 18.5 Z', 'M12.5 5.5 L20 12 L12.5 18.5 Z'),
      I('rewind', 'Rewind', 'back previous', 'M19.5 5.5 L12 12 L19.5 18.5 Z', 'M11.5 5.5 L4 12 L11.5 18.5 Z'),
      I('volume', 'Volume', 'sound audio speaker', 'M4 9 H8 L13 5 V19 L8 15 H4 Z', 'M16 9.5 a4 4 0 0 1 0 5', 'M18.5 7 a8 8 0 0 1 0 10'),
      I('mute', 'Mute', 'silent no sound', 'M4 9 H8 L13 5 V19 L8 15 H4 Z', 'M16.5 9.5 L21.5 14.5', 'M21.5 9.5 L16.5 14.5'),
      I('music', 'Music', 'note song audio', 'M9 18 V5 L20 3 V16', cir(6.8, 18, 2.2), cir(17.8, 16, 2.2)),
      I('camera', 'Camera', 'photo picture shoot', 'M3 7 h4 l2 -2.5 h6 L17 7 h4 v12 H3 Z', cir(12, 13, 3.5)),
      I('film', 'Film', 'movie video cinema', 'M3 4 h18 v16 H3 Z', 'M7 4 V20', 'M17 4 V20', 'M3 8 H7', 'M3 12 H7', 'M3 16 H7', 'M17 8 H21', 'M17 12 H21', 'M17 16 H21'),
      I('tv', 'TV', 'screen display monitor', 'M3 7 h18 v13 H3 Z', 'M8.5 3.5 L12 7 L15.5 3.5'),
      I('podcast', 'Podcast', 'broadcast waves audio', cir(12, 11, 2.2), 'M8 15.5 a5.5 5.5 0 1 1 8 0', 'M5.2 18.2 a9.5 9.5 0 1 1 13.6 0', 'M11 16 h2 l.5 5 h-3 Z'),
    ],
  },
  {
    id: 'files',
    label: 'Files',
    icons: [
      I('folder', 'Folder', 'directory organize', 'M3 6.5 a1.5 1.5 0 0 1 1.5 -1.5 H9 l2.5 2.5 H19.5 A1.5 1.5 0 0 1 21 9 V18 a1.5 1.5 0 0 1 -1.5 1.5 h-15 A1.5 1.5 0 0 1 3 18 Z'),
      I('folder-open', 'Open folder', 'directory active', 'M3 18 V5.5 H9.5 L11.5 8 H19 V10.5', 'M3 18 L5.5 10.5 H22 L19.5 18 Z'),
      I('file', 'File', 'document blank', 'M6 2.5 h8 l5 5 v14 h-13 Z', 'M14 2.5 V7.5 H19'),
      I('file-code', 'Code file', 'script source', 'M6 2.5 h8 l5 5 v14 h-13 Z', 'M14 2.5 V7.5 H19', 'M10 11.5 L8 13.5 L10 15.5', 'M14 11.5 L16 13.5 L14 15.5'),
      I('archive', 'Archive', 'zip box storage', 'M3 4 h18 v4.5 H3 Z', 'M5 8.5 V20 H19 V8.5', 'M10 12 H14'),
      I('book', 'Book', 'read manual docs', 'M3 5 c3 -1.5 6 -1.5 9 0 c3 -1.5 6 -1.5 9 0 V19 c-3 -1.5 -6 -1.5 -9 0 c-3 -1.5 -6 -1.5 -9 0 Z', 'M12 5 V19'),
      I('news', 'News', 'article newspaper press', 'M3 4.5 h18 v15 H3 Z', 'M7 9 H12', 'M7 12.5 H17', 'M7 16 H17', 'M15 9 H17'),
      I('certificate', 'Certificate', 'award diploma license', 'M4 4 h16 v12 H4 Z', 'M8 8 H16', 'M8 11.5 H13', cir(16.5, 16.5, 3), 'M15 19 V22.5 L16.5 21.5 L18 22.5 V19'),
    ],
  },
  {
    id: 'people',
    label: 'People & Emotion',
    icons: [
      I('smile', 'Smile', 'happy face emoji positive', cir(12, 12, 9), cir(8.8, 9.8, 0.6), cir(15.2, 9.8, 0.6), 'M8 14 a4.5 4.5 0 0 0 8 0'),
      I('frown', 'Frown', 'sad face emoji negative', cir(12, 12, 9), cir(8.8, 9.8, 0.6), cir(15.2, 9.8, 0.6), 'M8 15.8 a4.5 4.5 0 0 1 8 0'),
      I('meh', 'Meh', 'neutral face emoji okay', cir(12, 12, 9), cir(8.8, 9.8, 0.6), cir(15.2, 9.8, 0.6), 'M8.5 15 H15.5'),
      I('laugh', 'Laugh', 'joy face emoji lol', cir(12, 12, 9), cir(8.8, 9.3, 0.6), cir(15.2, 9.3, 0.6), 'M7.5 13 a4.7 4.7 0 0 0 9 0 Z'),
      I('thumbs-up', 'Thumbs up', 'like approve good', 'M7 11 L11 3.5 a2 2 0 0 1 2 2 V9 h5.5 a2 2 0 0 1 2 2.3 l-1.2 6.5 A2.5 2.5 0 0 1 16.8 20 H7', 'M7 11 H3.5 V20 H7 Z'),
      I('thumbs-down', 'Thumbs down', 'dislike reject bad', 'M17 13 L13 20.5 a2 2 0 0 1 -2 -2 V15 H5.5 a2 2 0 0 1 -2 -2.3 L4.7 6.2 A2.5 2.5 0 0 1 7.2 4 H17', 'M17 13 H20.5 V4 H17 Z'),
      I('id-badge', 'ID badge', 'identity employee profile card', 'M5 4 h14 v17 H5 Z', 'M9.5 4 V2.5 h5 V4', cir(12, 10, 2.5), 'M8 17.5 a4 4 0 0 1 8 0'),
      I('crown', 'Crown', 'king queen winner vip', 'M4 18 L3 7.5 L8.5 11 L12 5 L15.5 11 L21 7.5 L20 18 Z', 'M5.5 21 H18.5'),
      I('footprints', 'Steps', 'walk journey path', cir(6.7, 7, 2.5), 'M5.5 11.5 h2.5 v2 a1.25 1.25 0 0 1 -2.5 0 Z', cir(17.3, 13, 2.5), 'M16 17.5 h2.5 v2 a1.25 1.25 0 0 1 -2.5 0 Z'),
    ],
  },
  {
    id: 'nature',
    label: 'Nature & Weather',
    icons: [
      I('sun', 'Sun', 'day light weather bright', cir(12, 12, 4.5), 'M12 2.5 V5', 'M12 19 V21.5', 'M2.5 12 H5', 'M19 12 H21.5', 'M5.3 5.3 L7 7', 'M17 17 L18.7 18.7', 'M18.7 5.3 L17 7', 'M7 17 L5.3 18.7'),
      I('moon', 'Moon', 'night dark sleep', 'M20 14 A8.5 8.5 0 1 1 10 4 a7 7 0 0 0 10 10 Z'),
      I('cloud-rain', 'Rain', 'weather storm wet', 'M7 15.5 a4.5 4.5 0 1 1 .9 -8.9 A6 6 0 0 1 19 8.5 a3.5 3.5 0 0 1 -1 7', 'M8.5 18.5 L7.5 21', 'M12.5 18.5 L11.5 21', 'M16.5 18.5 L15.5 21'),
      I('snow', 'Snowflake', 'winter cold frozen', 'M12 3 V21', 'M4.2 7.5 L19.8 16.5', 'M19.8 7.5 L4.2 16.5', 'M9.5 4.5 L12 7 L14.5 4.5', 'M9.5 19.5 L12 17 L14.5 19.5'),
      I('lightning', 'Lightning', 'bolt energy fast power', 'M13 2 L5 13.5 H11 L9 22 L19 9.5 H12.5 Z'),
      I('rainbow', 'Rainbow', 'arc color weather', 'M3 17 a9 9 0 0 1 18 0', 'M6.5 17 a5.5 5.5 0 0 1 11 0', 'M10 17 a2 2 0 0 1 4 0'),
      I('tree', 'Tree', 'pine forest nature', 'M12 3 L17 10 H14.5 L19 16 H13.5 V21 H10.5 V16 H5 L9.5 10 H7 Z'),
      I('leaf', 'Leaf', 'plant eco green organic', 'M5.5 19 C5 10 11 4 20 4 C20 13 14 19 5.5 19 Z', 'M6.5 17.5 C10 13 13 10 17 7'),
      I('flower', 'Flower', 'bloom daisy plant', cir(12, 12, 2.5), ...rosette(12, 12, 5.2, 2.6, 6)),
      I('mountain', 'Mountains', 'peak landscape outdoor', 'M3 19 L9.5 7 L13 13 L16 9 L21 19 Z'),
      I('drop', 'Drop', 'water liquid rain', 'M12 3 C16 9 18.5 12 18.5 15 a6.5 6.5 0 0 1 -13 0 C5.5 12 8 9 12 3 Z'),
      I('fire', 'Fire', 'flame hot burn trending', 'M12 3 C14 6.5 17.5 9 17.5 14 a5.5 5.5 0 0 1 -11 0 C6.5 11 8 9.5 8.5 7.5 C10 9 10.8 10 11 11.5 C11.8 9 11.5 6 12 3 Z'),
      I('wind', 'Wind', 'air breeze weather', 'M3 8 H13 a2.5 2.5 0 1 0 -2.4 -3.2', 'M3 12 H19 a2.5 2.5 0 1 1 -2.4 3.2', 'M3 16 H11 a2 2 0 1 1 -1.9 2.6'),
      I('paw', 'Paw', 'animal pet dog cat', cir(8, 7.5, 1.8), cir(16, 7.5, 1.8), cir(4.8, 11.5, 1.7), cir(19.2, 11.5, 1.7), 'M12 11 c3 0 5.5 2.5 5.5 5 a3 3 0 0 1 -3 3 c-1 0 -1.8 -.5 -2.5 -.5 s-1.5 .5 -2.5 .5 a3 3 0 0 1 -3 -3 c0 -2.5 2.5 -5 5.5 -5 Z'),
    ],
  },
  {
    id: 'food',
    label: 'Food & Drink',
    icons: [
      I('coffee', 'Coffee', 'cup drink cafe', 'M4 8 h13 v6 a5 5 0 0 1 -5 5 h-3 a5 5 0 0 1 -5 -5 Z', 'M17 9.5 h1.5 a2.5 2.5 0 0 1 0 5 H16', 'M8 5 c0 -1.5 1 -1.5 1 -3', 'M12 5 c0 -1.5 1 -1.5 1 -3'),
      I('pizza', 'Pizza', 'slice food italian', 'M12 21 L4 6.5 C9 3.5 15 3.5 20 6.5 Z', cir(10, 8, 1), cir(14, 10.5, 1), cir(11, 13.5, 1)),
      I('apple', 'Apple', 'fruit healthy food', 'M12 7 c-1.5 -2 -4.5 -2.5 -6 0 c-2 3 -1 8.5 1.5 11.5 c1.5 1.8 3 1.8 4.5 1 c1.5 .8 3 .8 4.5 -1 C19 15.5 20 10 18 7 c-1.5 -2.5 -4.5 -2 -6 0 Z', 'M12 7 c0 -2 1 -3 2.5 -3.5'),
      I('cake', 'Cake', 'birthday celebration dessert', 'M4 11 h16 v9.5 H4 Z', 'M4 14.5 c2.7 2 5.3 -2 8 0 c2.7 2 5.3 -2 8 0', 'M9 11 V7.5', 'M15 11 V7.5', cir(9, 6, 0.7), cir(15, 6, 0.7)),
      I('beer', 'Beer', 'drink mug cheers', 'M6 6 h10 v14.5 H6 Z', 'M16 9 h2 a2 2 0 0 1 2 2 v3 a2 2 0 0 1 -2 2 h-2', cir(9, 10.5, 0.8), cir(12.5, 13.5, 0.8), cir(9.5, 16.5, 0.8)),
      I('wine', 'Wine', 'glass drink celebrate', 'M7 3.5 H17 C17 8.5 15 11.5 12 11.5 S7 8.5 7 3.5 Z', 'M12 11.5 V21.5', 'M8.5 21.5 H15.5'),
      I('utensils', 'Food', 'fork knife restaurant eat', 'M5.5 3 V8 a3.5 3.5 0 0 0 7 0 V3', 'M9 3 V21', 'M16.5 21 V3 c2.5 2 3.5 7 1.5 10.5 L16.5 14'),
      I('ice-cream', 'Ice cream', 'dessert cone sweet', 'M7.3 11 a4.8 4.8 0 0 1 9.4 0', 'M7.3 11 H16.7 L12 21.5 Z'),
    ],
  },
  {
    id: 'travel',
    label: 'Travel & Places',
    icons: [
      I('pin', 'Location', 'map place marker', 'M12 21 C7.5 16 5.5 12.8 5.5 10 a6.5 6.5 0 0 1 13 0 c0 2.8 -2 6 -6.5 11 Z', cir(12, 10, 2.2)),
      I('map', 'Map', 'navigation route travel', 'M9 4.5 L3.5 6.5 V19.5 L9 17.5 L15 19.5 L20.5 17.5 V4.5 L15 6.5 Z', 'M9 4.5 V17.5', 'M15 6.5 V19.5'),
      I('compass', 'Compass', 'direction navigate explore', cir(12, 12, 9), 'M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z'),
      I('car', 'Car', 'vehicle drive auto', 'M4 16 V11.5 L6.5 6.5 H17.5 L20 11.5 V16', 'M4 11.5 H20', cir(7.5, 16.5, 1.8), cir(16.5, 16.5, 1.8)),
      I('bus', 'Bus', 'transit public transport', 'M4 4 h16 v13 H4 Z', 'M4 10.5 H20', cir(8, 19, 1.6), cir(16, 19, 1.6), 'M7 13.8 h1', 'M16 13.8 h1'),
      I('bike', 'Bike', 'bicycle cycle ride', cir(6.5, 16.5, 3.8), cir(17.5, 16.5, 3.8), 'M6.5 16.5 L10 9 H15 L17.5 16.5', 'M10 9 L13.5 16.5 H6.5', 'M9 6.5 H11.5', 'M14 6.5 L15 9'),
      I('sailboat', 'Boat', 'sail ship sea', 'M3.5 16.5 H20.5 L17.5 20.5 H6.5 Z', 'M12 3.5 V16.5', 'M12 4.5 C16.5 6.5 18.5 10 18.5 13.5 H12 Z'),
      I('luggage', 'Luggage', 'suitcase trip travel', 'M6 7 h12 v13 H6 Z', 'M9.5 7 V4.5 h5 V7', 'M9.5 7 V20', 'M14.5 7 V20'),
      I('building', 'Building', 'office company city', 'M5 21 V3 h14 v18', 'M3 21 H21', 'M9 7 H10.5', 'M13.5 7 H15', 'M9 11 H10.5', 'M13.5 11 H15', 'M10.5 21 v-4 h3 v4'),
      I('store', 'Store', 'shop retail market', 'M4 8 L5.5 3.5 H18.5 L20 8', 'M4 8 a2.7 2.7 0 0 0 5.4 0 a2.7 2.7 0 0 0 5.2 0 a2.7 2.7 0 0 0 5.4 0', 'M5 10.5 V20 H19 V10.5', 'M10 20 v-5 h4 v5'),
      I('anchor', 'Anchor', 'ship marine stable', cir(12, 5, 2.2), 'M12 7.2 V21', 'M5 13 a7 7 0 0 0 14 0', 'M9 10.5 H15'),
      I('flag-finish', 'Finish', 'race checkered goal end', 'M5 21 V3.5', 'M5 4 H19 V13 H5', 'M8.5 4 V13', 'M12 4 V13', 'M15.5 4 V13', 'M5 8.5 H19'),
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icons: [
      I('gift', 'Gift', 'present box surprise', 'M3.5 5.5 h17 V9 h-17 Z', 'M5 9 V21 H19 V9', 'M12 5.5 V21', 'M12 5.5 C10 2 6 3 7.5 5.5', 'M12 5.5 C14 2 18 3 16.5 5.5'),
      I('umbrella', 'Umbrella', 'rain cover protect', 'M3.5 12 a8.5 8.5 0 0 1 17 0 Z', 'M12 12 V18.5 a2 2 0 0 1 -4 0'),
      I('glasses', 'Glasses', 'vision read nerd', cir(7, 15, 3.5), cir(17, 15, 3.5), 'M10.5 14.5 a1.5 1.2 0 0 1 3 0', 'M3.5 14 L5 8.5', 'M20.5 14 L19 8.5'),
      I('watch', 'Watch', 'time wrist clock', cir(12, 12, 5.5), 'M12 9.5 V12 L14 13.5', 'M9 7 L9.5 3 H14.5 L15 7', 'M9 17 L9.5 21 H14.5 L15 17'),
      I('scissors', 'Scissors', 'cut trim crop', cir(6, 7, 2.5), cir(6, 17, 2.5), 'M8 8.5 L20 18', 'M8 15.5 L20 6'),
      I('magnet', 'Magnet', 'attract pull science', 'M5 4 h4.5 V11 a2.5 2.5 0 0 0 5 0 V4 H19 V11 a7 7 0 0 1 -14 0 Z', 'M5 7.5 h4.5', 'M14.5 7.5 H19'),
      I('gem', 'Gem', 'diamond jewel precious', 'M7 3.5 H17 L21 9 L12 20.5 L3 9 Z', 'M3 9 H21', 'M7 3.5 L9.5 9 L12 20.5', 'M17 3.5 L14.5 9 L12 20.5'),
      I('dice', 'Dice', 'game random chance', 'M4 4 h16 v16 H4 Z', cir(8.5, 8.5, 0.9), cir(15.5, 8.5, 0.9), cir(12, 12, 0.9), cir(8.5, 15.5, 0.9), cir(15.5, 15.5, 0.9)),
      I('puzzle', 'Puzzle', 'piece solve fit', 'M5 4.5 h4.3 a2.3 2.3 0 1 1 4.4 0 H18 V9 a2.3 2.3 0 1 0 0 4.4 V19.5 h-4.8 a2.3 2.3 0 1 0 -4.4 0 H5 V14.5 a2.3 2.3 0 1 1 0 -4.4 Z'),
      I('gamepad', 'Gamepad', 'controller game play', 'M6.5 8 h11 a4.5 4.5 0 0 1 4.4 5.4 L21 16.5 a2.4 2.4 0 0 1 -4.3 1.1 L15.2 15.5 H8.8 L7.3 17.6 A2.4 2.4 0 0 1 3 16.5 l-.9 -3.1 A4.5 4.5 0 0 1 6.5 8 Z', 'M8 11 v3.5', 'M6.3 12.8 h3.5', cir(15.7, 11.3, 0.8), cir(17.7, 13.3, 0.8)),
      I('battery', 'Battery', 'power charge energy', 'M2.5 9 h17 v7.5 h-17 Z', 'M21.5 11.5 v2.5', 'M5.5 11 v3.5', 'M8.5 11 v3.5', 'M11.5 11 v3.5'),
      I('hourglass-obj', 'Hourglass', 'time sand wait', 'M6 3 H18', 'M6 21 H18', 'M7.5 3 V7 C7.5 10 12 11 12 12 C12 13 7.5 14 7.5 17 V21', 'M16.5 3 V7 C16.5 10 12 11 12 12 C12 13 16.5 14 16.5 17 V21'),
      I('balloon', 'Balloon', 'party celebrate float', 'M12 3 a6 6.8 0 0 1 6 6.8 c0 3.4 -2.7 6.2 -6 6.2 s-6 -2.8 -6 -6.2 A6 6.8 0 0 1 12 3 Z', 'M11 16 h2 l-1 2 Z', 'M12 18 c0 1.5 -1 2 -1 3.5'),
      I('bomb', 'Bomb', 'explode boom deadline', cir(10, 14, 7), 'M14.5 8.5 L17 6', 'M17 6 C17.5 4.5 19 3.5 20.5 4', cir(20, 4.5, 0.4)),
    ],
  },
  {
    id: 'geometry',
    label: 'Geometric',
    icons: [
      I('triangle-shape', 'Triangle', 'shape polygon three', poly(12, 13.4, 9.8, 3)),
      I('square-shape', 'Square', 'shape four box', 'M4.5 4.5 h15 v15 h-15 Z'),
      I('diamond-shape', 'Diamond', 'shape rhombus', 'M12 3 L21 12 L12 21 L3 12 Z'),
      I('pentagon', 'Pentagon', 'shape five polygon', poly(12, 12.8, 9.5, 5)),
      I('hexagon', 'Hexagon', 'shape six polygon', poly(12, 12, 9.3, 6, 0)),
      I('octagon', 'Octagon', 'shape eight polygon stop', poly(12, 12, 9.3, 8, Math.PI / 8)),
      I('parallelogram', 'Parallelogram', 'shape slant skew', 'M7 6 H21 L17 18 H3 Z'),
      I('trapezoid', 'Trapezoid', 'shape quad', 'M7.5 6 H16.5 L21 18 H3 Z'),
      I('star-4', 'Sparkle', 'star four twinkle', star(12, 12, 9.5, 3.2, 4)),
      I('star-6', 'Star six', 'hexagram shape', star(12, 12, 9.3, 5, 6)),
      I('star-8', 'Star eight', 'compass star shape', star(12, 12, 9.3, 4.6, 8)),
      I('burst', 'Burst', 'explosion badge sale', star(12, 12, 9.5, 6.8, 12)),
      I('circle-shape', 'Circle', 'shape round ring', cir(12, 12, 9)),
      I('donut', 'Donut', 'ring torus circle', cir(12, 12, 9), cir(12, 12, 4)),
      I('concentric', 'Concentric', 'circles ripple rings', cir(12, 12, 9), cir(12, 12, 6), cir(12, 12, 3)),
      I('venn', 'Venn', 'overlap intersection sets', cir(9, 12, 6), cir(15, 12, 6)),
      I('crescent', 'Crescent', 'moon shape curve', 'M19.5 15 A8.5 8.5 0 1 1 10.5 4.5 a7 7 0 0 0 9 10.5 Z'),
      I('spiral', 'Spiral', 'swirl coil hypnotic', 'M12 12 a1.5 1.5 0 0 1 1.5 1.5 a3 3 0 0 1 -3 3 a4.5 4.5 0 0 1 -4.5 -4.5 a6 6 0 0 1 6 -6 a7.5 7.5 0 0 1 7.5 7.5 a9 9 0 0 1 -9 9'),
      I('wave-line', 'Wave', 'sine curve flow', 'M2 12 c2 -4.5 4.5 -4.5 6.5 0 s4.5 4.5 6.5 0 s4.5 -4.5 6.5 0'),
      I('zigzag', 'Zigzag', 'lightning sharp line', 'M3 16 L7.5 8 L12 16 L16.5 8 L21 16'),
      I('asterisk-shape', 'Asterisk', 'star lines six', 'M12 4 V20', 'M5.1 8 L18.9 16', 'M18.9 8 L5.1 16'),
      I('cube', 'Cube', 'box 3d isometric', 'M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z', 'M4 7.5 L12 12 L20 7.5', 'M12 12 V21'),
      I('pyramid', 'Pyramid', '3d triangle egypt', 'M12 3 L21 18 H3 Z', 'M12 3 L9 18'),
      I('planet', 'Planet', 'saturn ring space', cir(12, 12, 6), 'M2.5 14.8 C8 17 17 12 21.5 7.8'),
      I('rosette', 'Rosette', 'flower of life pattern', ...rosette(12, 12, 4.6, 4.6, 6)),
      I('dots-grid', 'Dot grid', 'pattern matrix points', cir(5, 5, 1), cir(12, 5, 1), cir(19, 5, 1), cir(5, 12, 1), cir(12, 12, 1), cir(19, 12, 1), cir(5, 19, 1), cir(12, 19, 1), cir(19, 19, 1)),
      I('block-arrow', 'Block arrow', 'shape arrow right big', 'M3 9.5 H13 V5.5 L21 12 L13 18.5 V14.5 H3 Z'),
      I('infinity-shape', 'Infinity', 'loop forever endless', 'M12 12 C9 8 4 8.5 4 12 s5 4 8 0 c3 -4 8 -3.5 8 0 s-5 4 -8 0'),
      I('hex-nut', 'Nut', 'bolt hardware hexagon', poly(12, 12, 9, 6, 0), cir(12, 12, 3.5)),
      I('semicircle', 'Semicircle', 'half circle dome arc', 'M3 15.5 a9 9 0 0 1 18 0 Z'),
    ],
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icons: [
      I('question', 'Question', 'help unknown faq', cir(12, 12, 9), 'M9 9.5 a3 3 0 1 1 4.4 2.6 c-1 .5 -1.4 1 -1.4 2.2', cir(12, 17, 0.5)),
      I('exclamation', 'Exclamation', 'alert important notice', cir(12, 12, 9), 'M12 7 V13', cir(12, 16.5, 0.5)),
      I('plus-circle', 'Plus circle', 'add new create', cir(12, 12, 9), 'M12 8 V16', 'M8 12 H16'),
      I('minus-circle', 'Minus circle', 'remove subtract', cir(12, 12, 9), 'M8 12 H16'),
      I('at', 'At sign', 'email mention handle', cir(12, 12, 4), 'M16 8 V13.5 a2.3 2.3 0 0 0 4.6 0 V12 a8.6 8.6 0 1 0 -3.4 6.9'),
      I('hash', 'Hashtag', 'number pound tag', 'M9.5 4 L8 20', 'M16 4 L14.5 20', 'M5 9 H20', 'M4 15 H19'),
      I('percent', 'Percent', 'discount rate ratio', 'M5 19 L19 5', cir(7, 7, 2.6), cir(17, 17, 2.6)),
      I('ampersand', 'Ampersand', 'and symbol', 'M18 21 C12 15 8 11 8 7.5 a3.5 3.5 0 0 1 7 0 c0 2.3 -2 3.8 -4.5 5.3 C8 14.3 6.5 16 6.5 18 a3.5 3.5 0 0 0 3.5 3.5 c2.8 0 5 -2 6.5 -5.5'),
      I('power', 'Power', 'on off switch', 'M12 3 V12', 'M7.5 6 a8 8 0 1 0 9 0'),
      I('euro', 'Euro', 'currency money eu', 'M17.5 6 a7.5 7.5 0 1 0 0 12', 'M4.5 10 H13', 'M4.5 14 H12'),
      I('yen', 'Yen', 'currency money japan', 'M6 4 L12 11.5 L18 4', 'M12 11.5 V20', 'M8 13.5 H16', 'M8 17 H16'),
      I('pound', 'Pound', 'currency money uk sterling', 'M7 20 c2 -1.5 2.5 -4 2.5 -6 V9 a4 4 0 0 1 7.3 -2.2', 'M6.5 13 H14', 'M7 20 H17.5'),
      I('bitcoin', 'Bitcoin', 'crypto currency btc', 'M9 4.5 V19.5', 'M9 4.5 H14 a2.9 2.9 0 0 1 0 5.8 H9', 'M9 10.3 H15 a4.6 4.6 0 0 1 0 9.2 H9', 'M10.8 2.5 V4.5', 'M13.8 2.5 V4.5', 'M10.8 19.5 V21.5', 'M13.8 19.5 V21.5'),
      I('peace', 'Peace', 'symbol harmony', cir(12, 12, 9), 'M12 3 V21', 'M12 12 L5.6 18.4', 'M12 12 L18.4 18.4'),
      I('repeat', 'Repeat', 'loop cycle process recycle', 'M3 16.5 H15.5 a5 5 0 0 0 0 -10 H3', 'M7 12.5 L3 16.5 L7 20.5'),
    ],
  },
  {
    id: 'science',
    label: 'Math & Science',
    icons: [
      I('atom', 'Atom', 'physics science nucleus', cir(12, 12, 1.6), 'M3 12 a9 3.6 0 1 0 18 0 a9 3.6 0 1 0 -18 0', 'M7.5 4.21 a9 3.6 60 1 0 9 15.58 a9 3.6 60 1 0 -9 -15.58', 'M16.5 4.21 a9 3.6 120 1 0 -9 15.58 a9 3.6 120 1 0 9 -15.58'),
      I('flask', 'Flask', 'chemistry lab experiment', 'M10 3 V9.5 L4.8 18.5 A2.2 2.2 0 0 0 6.8 21.5 H17.2 A2.2 2.2 0 0 0 19.2 18.5 L14 9.5 V3', 'M9 3 H15', 'M7.5 15.5 H16.5'),
      I('dna', 'DNA', 'biology genetics helix', 'M7 3 c0 6 10 6 10 12 c0 3 -3 4.5 -5 6', 'M17 3 c0 6 -10 6 -10 12 c0 3 3 4.5 5 6', 'M8 6 H16', 'M7.5 12 H16.5', 'M8 18 H16'),
      I('calculator', 'Calculator', 'math compute numbers', 'M5 3 h14 v18 H5 Z', 'M8 6 h8 v3 H8 Z', cir(8.8, 12.5, 0.7), cir(12, 12.5, 0.7), cir(15.2, 12.5, 0.7), cir(8.8, 16.5, 0.7), cir(12, 16.5, 0.7), cir(15.2, 16.5, 0.7)),
      I('pi', 'Pi', 'math constant greek', 'M4 7 C5 5.5 6 5 8 5 H20', 'M9 5 V19', 'M16 5 V17 a2 2 0 0 0 3 1.7'),
      I('sigma', 'Sigma', 'sum math greek total', 'M18 5 H6 L13 12 L6 19 H18'),
      I('angle-tool', 'Angle', 'degrees geometry measure', 'M19 19 H4 L16 4', 'M9.5 19 a8 8 0 0 0 -2.3 -5.5'),
      I('telescope', 'Telescope', 'astronomy explore discover', 'M4 10 L16.5 4 L19 9 L6.5 15 Z', 'M9 14 L5.5 21', 'M12 13.5 L15.5 21', cir(11, 13, 1.2)),
      I('microscope', 'Microscope', 'lab biology research', 'M9.5 3.5 h2.5 V10 H9.5 Z', 'M12 10 A5.5 5.5 0 0 1 14.5 20', 'M4.5 21 H19.5', 'M7 17.5 H13', 'M10.75 14 V17.5'),
      I('brain', 'Brain', 'mind intelligence think ai', 'M11.5 3.5 A3 3 0 0 0 8.4 6.4 A3.2 3.2 0 0 0 5.8 11.3 A3.4 3.4 0 0 0 6.3 17 A3 3 0 0 0 11.5 18.5 Z', 'M12.5 3.5 A3 3 0 0 1 15.6 6.4 A3.2 3.2 0 0 1 18.2 11.3 A3.4 3.4 0 0 1 17.7 17 A3 3 0 0 1 12.5 18.5 Z', 'M12 3.5 V18.5'),
    ],
  },
  {
    id: 'time',
    label: 'Time',
    icons: [
      I('clock', 'Clock', 'time hour watch', cir(12, 12, 9), 'M12 7 V12 L15.5 14'),
      I('hourglass', 'Hourglass', 'sand wait pending', 'M6 3 H18', 'M6 21 H18', 'M7.5 3 V7 C7.5 10 12 11 12 12 C12 13 7.5 14 7.5 17 V21', 'M16.5 3 V7 C16.5 10 12 11 12 12 C12 13 16.5 14 16.5 17 V21'),
      I('stopwatch', 'Stopwatch', 'timer speed measure', cir(12, 13.5, 7.5), 'M12 9.5 V13.5 L14.8 15', 'M9.5 2.5 H14.5', 'M12 2.5 V6', 'M18.5 7 L20 5.5'),
      I('alarm', 'Alarm', 'wake reminder ring', cir(12, 13, 7), 'M12 9.5 V13 L14.5 14.5', 'M4.5 5.5 L7.5 3', 'M19.5 5.5 L16.5 3'),
      I('history', 'History', 'past recent undo time', 'M3 12 a9 9 0 1 0 9 -9 a9.7 9.7 0 0 0 -6.7 2.7 L3 8', 'M3 3 V8 H8', 'M12 8 V12 L15 13.8'),
      I('calendar-check', 'Scheduled', 'date done planned', 'M3 5 h18 v16 h-18 Z', 'M3 10 H21', 'M8 3 V7', 'M16 3 V7', 'M8.5 15 L11 17.5 L15.5 13'),
    ],
  },
  {
    id: 'health',
    label: 'Health',
    icons: [
      I('heart-pulse', 'Heartbeat', 'health pulse cardio', 'M12 20.5 C5 15 3 11.5 3 8.5 a4.5 4.5 0 0 1 9 -1.5 a4.5 4.5 0 0 1 9 1.5 c0 3 -2 6.5 -9 12 Z', 'M6 11.5 H9.5 L11 9 L13 14 L14.5 11.5 H18'),
      I('medical', 'Medical', 'cross health hospital', 'M9 3.5 h6 V9 h5.5 v6 H15 v5.5 H9 V15 H3.5 V9 H9 Z'),
      I('pill', 'Pill', 'medicine drug capsule', 'M5 5 a4.6 4.6 0 0 1 6.5 0 l7.5 7.5 a4.6 4.6 0 0 1 -6.5 6.5 L5 11.5 A4.6 4.6 0 0 1 5 5 Z', 'M8.7 8.7 L15.2 15.2'),
      I('dumbbell', 'Fitness', 'gym exercise weight', 'M2.5 12 H4.5', 'M19.5 12 H21.5', 'M5 8 h2.5 v8 H5 Z', 'M16.5 8 H19 v8 h-2.5 Z', 'M7.5 12 H16.5'),
      I('sleep', 'Sleep', 'rest zzz night', 'M5 5 H11 L5 11 H11', 'M13.5 10 H18 L13.5 14.5 H18', 'M8 16 H12 L8 20 H12'),
    ],
  },
];

// flatten + duplicate-id guard happens at module init
export const ICONS: IconDef[] = ICON_CATEGORIES.flatMap((c) => c.icons);

// Path2D cache — icon geometry is static per id
const pathCache = new Map<string, Path2D[]>();

export function iconPaths(id: string): Path2D[] {
  let paths = pathCache.get(id);
  if (!paths) {
    const def = ICONS.find((i) => i.id === id);
    paths = (def?.d ?? []).map((d) => new Path2D(d));
    pathCache.set(id, paths);
  }
  return paths;
}

export function iconDef(id: string): IconDef | undefined {
  return ICONS.find((i) => i.id === id);
}
