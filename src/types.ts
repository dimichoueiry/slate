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

/** An uploaded file attached to a node, extracted to text so AI nodes can read it. */
export interface UploadFile {
  name: string;
  mime: string;
  size: number; // bytes
  kind: 'csv' | 'text' | 'json' | 'markdown' | 'pdf';
  /** in-doc preview of the content (capped — see `truncated`). For a capped CSV
   *  the COMPLETE file lives in the blob store under `blobId`. */
  text: string;
  /** csv only: TRUE data row count of the whole file (excludes header) */
  rows?: number;
  /** the inline `text` preview was capped. Data is only lost when `blobId` is
   *  absent — a capped CSV with a `blobId` is still complete for analytics. */
  truncated?: boolean;
  /** blob-store id of the full original file. Set for capped CSVs (so analytics
   *  reads every row) and PDFs (to re-extract). */
  blobId?: string;
}

export interface StickyObj extends BaseObj {
  type: 'sticky';
  w: number;
  h: number;
  color: string; // note background
  text: string;
  fontSize: number;
  fontFamily?: string; // FONTS id
  /** present on "upload:" nodes — the uploaded file's extracted content */
  file?: UploadFile;
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
  /** text drawn at the midpoint of the connector */
  label?: string;
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
  brandKitId?: string | null; // active brand kit for this board
  projectId?: string | null; // folder/project this board belongs to
  canvasDark?: boolean; // per-board dark canvas surface (default = light paper)
}

/** A folder/project grouping boards on the home screen. */
export interface Project {
  id: string;
  name: string;
  createdAt: number;
  brandKitId?: string | null; // default brand kit for boards in this project
}

/** A reusable brand kit applied to AI nodes on a board. */
export interface BrandKit {
  id: string;
  name: string;
  voice: string; // tone / writing style guidance
  audience: string; // who the content is for
  donts: string; // things to avoid
  palette: string[]; // hex colors
  fontFamily?: string; // FONTS id
  logoBlobId?: string; // optional logo image
  createdAt: number;
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

export interface FontDef {
  id: string;
  label: string;
  stack: string;
  cat: 'Sans' | 'Serif' | 'Display' | 'Handwriting' | 'Mono' | 'Retro';
}

export const FONTS: FontDef[] = [
  // ---- sans ----
  {
    id: 'sans',
    label: 'System Sans',
    stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    cat: 'Sans',
  },
  { id: 'inter', label: 'Inter', stack: "'Inter', sans-serif", cat: 'Sans' },
  { id: 'roboto', label: 'Roboto', stack: "'Roboto', sans-serif", cat: 'Sans' },
  { id: 'open-sans', label: 'Open Sans', stack: "'Open Sans', sans-serif", cat: 'Sans' },
  { id: 'lato', label: 'Lato', stack: "'Lato', sans-serif", cat: 'Sans' },
  { id: 'poppins', label: 'Poppins', stack: "'Poppins', sans-serif", cat: 'Sans' },
  { id: 'montserrat', label: 'Montserrat', stack: "'Montserrat', sans-serif", cat: 'Sans' },
  { id: 'raleway', label: 'Raleway', stack: "'Raleway', sans-serif", cat: 'Sans' },
  { id: 'work-sans', label: 'Work Sans', stack: "'Work Sans', sans-serif", cat: 'Sans' },
  { id: 'dm-sans', label: 'DM Sans', stack: "'DM Sans', sans-serif", cat: 'Sans' },
  { id: 'rubik', label: 'Rubik', stack: "'Rubik', sans-serif", cat: 'Sans' },
  { id: 'nunito', label: 'Nunito', stack: "'Nunito', sans-serif", cat: 'Sans' },
  { id: 'quicksand', label: 'Quicksand', stack: "'Quicksand', sans-serif", cat: 'Sans' },
  { id: 'space-grotesk', label: 'Space Grotesk', stack: "'Space Grotesk', sans-serif", cat: 'Sans' },
  { id: 'josefin', label: 'Josefin Sans', stack: "'Josefin Sans', sans-serif", cat: 'Sans' },
  { id: 'geo', label: 'Futura', stack: "Futura, 'Avenir Next', 'Century Gothic', sans-serif", cat: 'Sans' },
  // ---- serif ----
  { id: 'serif', label: 'System Serif', stack: "Georgia, 'Iowan Old Style', 'Times New Roman', serif", cat: 'Serif' },
  { id: 'playfair', label: 'Playfair Display', stack: "'Playfair Display', serif", cat: 'Serif' },
  { id: 'lora', label: 'Lora', stack: "'Lora', serif", cat: 'Serif' },
  { id: 'merriweather', label: 'Merriweather', stack: "'Merriweather', serif", cat: 'Serif' },
  { id: 'garamond', label: 'EB Garamond', stack: "'EB Garamond', serif", cat: 'Serif' },
  { id: 'baskerville', label: 'Libre Baskerville', stack: "'Libre Baskerville', serif", cat: 'Serif' },
  { id: 'cormorant', label: 'Cormorant Garamond', stack: "'Cormorant Garamond', serif", cat: 'Serif' },
  { id: 'bitter', label: 'Bitter', stack: "'Bitter', serif", cat: 'Serif' },
  { id: 'roboto-slab', label: 'Roboto Slab', stack: "'Roboto Slab', serif", cat: 'Serif' },
  { id: 'elegant', label: 'Didot', stack: "Didot, 'Bodoni 72', 'Playfair Display', Georgia, serif", cat: 'Serif' },
  // ---- display ----
  { id: 'bebas', label: 'Bebas Neue', stack: "'Bebas Neue', sans-serif", cat: 'Display' },
  { id: 'oswald', label: 'Oswald', stack: "'Oswald', sans-serif", cat: 'Display' },
  { id: 'anton', label: 'Anton', stack: "'Anton', sans-serif", cat: 'Display' },
  { id: 'archivo-black', label: 'Archivo Black', stack: "'Archivo Black', sans-serif", cat: 'Display' },
  { id: 'abril', label: 'Abril Fatface', stack: "'Abril Fatface', serif", cat: 'Display' },
  { id: 'righteous', label: 'Righteous', stack: "'Righteous', sans-serif", cat: 'Display' },
  { id: 'lobster', label: 'Lobster', stack: "'Lobster', cursive", cat: 'Display' },
  { id: 'comfortaa', label: 'Comfortaa', stack: "'Comfortaa', sans-serif", cat: 'Display' },
  { id: 'barlow-cond', label: 'Barlow Condensed', stack: "'Barlow Condensed', sans-serif", cat: 'Display' },
  // ---- handwriting ----
  { id: 'caveat', label: 'Caveat', stack: "'Caveat', cursive", cat: 'Handwriting' },
  { id: 'pacifico', label: 'Pacifico', stack: "'Pacifico', cursive", cat: 'Handwriting' },
  { id: 'dancing', label: 'Dancing Script', stack: "'Dancing Script', cursive", cat: 'Handwriting' },
  { id: 'great-vibes', label: 'Great Vibes', stack: "'Great Vibes', cursive", cat: 'Handwriting' },
  { id: 'shadows', label: 'Shadows Into Light', stack: "'Shadows Into Light', cursive", cat: 'Handwriting' },
  { id: 'indie', label: 'Indie Flower', stack: "'Indie Flower', cursive", cat: 'Handwriting' },
  { id: 'kalam', label: 'Kalam', stack: "'Kalam', cursive", cat: 'Handwriting' },
  { id: 'patrick', label: 'Patrick Hand', stack: "'Patrick Hand', cursive", cat: 'Handwriting' },
  { id: 'marker', label: 'Permanent Marker', stack: "'Permanent Marker', cursive", cat: 'Handwriting' },
  { id: 'bangers', label: 'Bangers', stack: "'Bangers', cursive", cat: 'Handwriting' },
  { id: 'hand', label: 'Noteworthy', stack: "Noteworthy, 'Marker Felt', 'Bradley Hand', 'Comic Sans MS', cursive", cat: 'Handwriting' },
  // ---- mono ----
  { id: 'mono', label: 'SF Mono', stack: "'SF Mono', Menlo, Consolas, 'Courier New', monospace", cat: 'Mono' },
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono', monospace", cat: 'Mono' },
  { id: 'fira-code', label: 'Fira Code', stack: "'Fira Code', monospace", cat: 'Mono' },
  { id: 'space-mono', label: 'Space Mono', stack: "'Space Mono', monospace", cat: 'Mono' },
  { id: 'courier-prime', label: 'Courier Prime', stack: "'Courier Prime', monospace", cat: 'Mono' },
  // ---- retro ----
  { id: 'press-start', label: 'Press Start 2P', stack: "'Press Start 2P', monospace", cat: 'Retro' },
  { id: 'vt323', label: 'VT323', stack: "'VT323', monospace", cat: 'Retro' },
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
