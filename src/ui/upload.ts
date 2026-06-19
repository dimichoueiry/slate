// Upload-node plumbing: turn a dropped/picked File into a UploadFile payload
// (extracted to text) that any AI node can read via gatherInputs. CSV/TSV/TXT/
// JSON/Markdown are read directly; PDF goes through pdfjs-dist in the browser.
import type { UploadFile } from '../types';

/** Cap extracted text so a big file can't bloat the doc or blow token limits. */
const MAX_TEXT = 200_000;

const TEXT_EXT: Record<string, UploadFile['kind']> = {
  csv: 'csv',
  tsv: 'csv',
  txt: 'text',
  log: 'text',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
};

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Is this a file the upload node can ingest? (used to gate drop/paste handling) */
export function isUploadable(file: File): boolean {
  const e = ext(file.name);
  return e === 'pdf' || file.type === 'application/pdf' || e in TEXT_EXT || file.type.startsWith('text/');
}

function classify(file: File): UploadFile['kind'] {
  const e = ext(file.name);
  if (e === 'pdf' || file.type === 'application/pdf') return 'pdf';
  return TEXT_EXT[e] ?? 'text';
}

/** Count CSV/TSV data rows (excludes header). Cheap, just for the summary label. */
function countRows(text: string): number {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

let pdfWorkerReady = false;
async function extractPdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfWorkerReady) {
    // Vite resolves the worker to a real URL; pdfjs needs it set before getDocument.
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfWorkerReady = true;
  }
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  let chars = 0;
  for (let i = 1; i <= pdf.numPages && chars < MAX_TEXT; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    parts.push(pageText);
    chars += pageText.length;
    page.cleanup();
  }
  await pdf.destroy();
  return parts.join('\n\n');
}

/** Read a File into an UploadFile payload (extracted to text). Throws on parse failure. */
export async function readUpload(file: File): Promise<UploadFile> {
  const kind = classify(file);
  let text = kind === 'pdf' ? await extractPdf(file) : await file.text();

  const truncated = text.length > MAX_TEXT;
  if (truncated) text = text.slice(0, MAX_TEXT);

  const out: UploadFile = { name: file.name, mime: file.type || kind, size: file.size, kind, text, truncated };
  if (kind === 'csv') out.rows = countRows(text);
  return out;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human summary shown as the node's sticky text (the full content stays in `file.text`). */
export function uploadLabel(f: UploadFile): string {
  const meta =
    f.kind === 'csv' && f.rows != null
      ? `${f.rows.toLocaleString()} rows · ${fmtBytes(f.size)}`
      : `${f.kind.toUpperCase()} · ${fmtBytes(f.size)}`;
  return `📎 upload: ${f.name}\n${meta}${f.truncated ? ' · truncated' : ''}`;
}
