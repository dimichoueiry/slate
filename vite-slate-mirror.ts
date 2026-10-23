// The ./data mirror's HTTP handler (mounted at /__slate by vite-slate-persist).
// Kept free of Vite imports so tests can drive it against a temp directory.
//   GET  /snapshot      → { boards, components, projects }
//   PUT  /board/:id     → data/boards/<id>.json      DELETE /board/:id
//   PUT  /components    → data/components.json
//   PUT  /projects      → data/projects.json
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export function createMirrorHandler(dataDir: string) {
  const boardsDir = path.join(dataDir, 'boards');
  const readJson = (file: string, fallback: unknown) => {
    try {
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
    } catch {
      return fallback;
    }
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    const send = (code: number, body = '{}') => {
      res.statusCode = code;
      res.setHeader('content-type', 'application/json');
      res.end(body);
    };
    const readBody = (cb: (body: string) => void) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => cb(body));
    };
    try {
      if (req.method === 'GET' && url === '/snapshot') {
        const boards = fs.existsSync(boardsDir)
          ? fs
              .readdirSync(boardsDir)
              .filter((f) => f.endsWith('.json'))
              .map((f) => readJson(path.join(boardsDir, f), null))
              .filter(Boolean)
          : [];
        const components = readJson(path.join(dataDir, 'components.json'), []);
        const projects = readJson(path.join(dataDir, 'projects.json'), []);
        return send(200, JSON.stringify({ boards, components, projects }));
      }
      if (url.startsWith('/board/')) {
        const id = url.slice('/board/'.length).replace(/[^A-Za-z0-9_-]/g, '');
        if (!id) return send(400);
        const file = path.join(boardsDir, `${id}.json`);
        if (req.method === 'PUT') {
          readBody((body) => {
            fs.mkdirSync(boardsDir, { recursive: true });
            fs.writeFileSync(file, body);
            send(200);
          });
          return;
        }
        if (req.method === 'DELETE') {
          fs.rmSync(file, { force: true });
          return send(200);
        }
      }
      if (req.method === 'PUT' && (url === '/components' || url === '/projects')) {
        readBody((body) => {
          fs.writeFileSync(path.join(dataDir, `${url.slice(1)}.json`), body);
          send(200);
        });
        return;
      }
      send(404, '{"error":"not found"}');
    } catch (e) {
      send(500, JSON.stringify({ error: String(e) }));
    }
  };
}
