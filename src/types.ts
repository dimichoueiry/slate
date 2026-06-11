// Slate scene-graph object model (PRD §8.3)

export interface Vec {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PenTool = 'fineliner' | 'pen' | 'pencil' | 'marker' | 'brush';

export type ShapeKind =
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'parallelogram';

export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type AnchorSide = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type Routing = 'straight' | 'elbow' | 'curved';
export type ArrowHead = 'none' | 'triangle';

interface BaseObj {
  id: string;
  /** fractional z-order; render sorted ascending */
  z: number;
  x: number;
  y: number;
  rotation: number; // radians, around object center
  locked?: boolean;
  groupId?: string | null;
  parentId?: string | null; // frame containment
}

export interface StrokeObj extends BaseObj {
  type: 'stroke';
  tool: PenTool;
  color: string;
  size: number;
  opacity: number;
  /** flat [x, y, pressure, ...] triples, relative to (x, y) */
  points: number[];
  w: number;
  h: number;
}

export interface ShapeObj extends BaseObj {
  type: 'shape';
  shape: ShapeKind;
  w: number;
  h: number;
  fill: string; // 'transparent' allowed
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  radius: number; // corner radius for roundedRect
  opacity: number;
  text: string;
  textColor: string;
  fontSize: number;
  fontFamily?: string; // FONTS id
  /** hand-drawn (roughjs) rendering */
  sketchy?: boolean;
  /** stable seed so the sketchy jitter doesn't change between frames */
  seed?: number;
}

export interface StickyObj extends BaseObj {
  type: 'sticky';
  w: number;
  h: number;
  color: string; // note background
  text: string;
  fontSize: number;
  fontFamily?: string; // FONTS id
}

export interface TextObj extends BaseObj {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  fontFamily?: string; // FONTS id
  w: number; // measured/wrapped width
  h: number;
  fixedWidth: boolean;
}

export interface ImageObj extends BaseObj {
  type: 'image';
  w: number;
  h: number;
  blobId: string;
  opacity: number;
  radius: number;
}

export interface ConnectorEnd {
  objectId?: string | null;
  anchor?: AnchorSide;
  /** world point used when not attached to an object */
  point?: Vec;
}

export interface ConnectorObj extends BaseObj {
  type: 'connector';
  from: ConnectorEnd;
  to: ConnectorEnd;
  routing: Routing;
  stroke: string;
  strokeWidth: number;
  dash: DashStyle;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  opacity: number;
}

export interface IconObj extends BaseObj {
  type: 'icon';
  icon: string; // id in the ICONS registry
  w: number;
  h: number;
  color: string;
  opacity: number;
  /** stroke width in icon-local (24-unit) space; default 2 */
  strokeWidth?: number;
}

export interface FrameObj extends BaseObj {
  type: 'frame';
  name: string;
  w: number;
  h: number;
}

export type SlateObj =
  | StrokeObj
  | ShapeObj
  | StickyObj
  | TextObj
  | ImageObj
  | ConnectorObj
  | IconObj
  | FrameObj;

export type ObjType = SlateObj['type'];

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  viewport: { x: number; y: number; zoom: number };
  thumb?: string; // small png data url
  pinned?: boolean;
  notes?: string; // markdown side-panel content
}

export type ToolId =
  | 'select'
  | 'hand'
  | 'pen'
  | 'eraser'
  | 'rect'
  | 'roundedRect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'line'
  | 'connector'
  | 'sticky'
  | 'text'
  | 'frame';

export const STICKY_COLORS = [
  '#FFE066',
  '#FFB3BA',
  '#B5EAD7',
  '#A8D8EA',
  '#E2C2FF',
  '#FFD6A5',
  '#F1F0EC',
];

export const FONTS: { id: string; label: string; stack: string }[] = [
  {
    id: 'sans',
    label: 'Sans',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  },
  { id: 'serif', label: 'Serif', stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif" },
  { id: 'elegant', label: 'Elegant', stack: "Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif" },
  { id: 'geo', label: 'Futura', stack: "Futura, 'Avenir Next', 'Century Gothic', sans-serif" },
  { id: 'hand', label: 'Hand', stack: "Noteworthy, 'Marker Felt', 'Bradley Hand', 'Comic Sans MS', cursive" },
  { id: 'mono', label: 'Mono', stack: "'SF Mono', Menlo, Consolas, 'Courier New', monospace" },
];

export function fontStack(id?: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).stack;
}

export const PALETTE = [
  '#1a1a1a',
  '#e03131',
  '#f08c00',
  '#ffd43b',
  '#2f9e44',
  '#1971c2',
  '#6741d9',
  '#e64980',
  '#868e96',
  '#ffffff',
];
