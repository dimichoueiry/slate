// Dev-only persistence: mirrors boards/components from the browser's IndexedDB
// into ./data as plain JSON files, and restores them on startup — so your work
// survives origin/port changes, browser-storage wipes, anything.
import type { Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default function slatePersist(): Plugin {
  let dataDir = '';
  const boardsDir = () => path.join(dataDir, 'boards');

  return {
    name: 'slate-persist',
    apply: 'serve', // dev server only — provides the ./data file-mirror endpoints
    configResolved(config) {
      dataDir = path.join(config.root, 'data');
      fs.mkdirSync(boardsDir(), { recursive: true });
    },
    configureServer(server) {
      server.middlewares.use('/__slate', (req, res) => {
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
            const boards = fs.existsSync(boardsDir())
              ? fs
                  .readdirSync(boardsDir())
                  .filter((f) => f.endsWith('.json'))
                  .map((f) => {
                    try {
                      return JSON.parse(fs.readFileSync(path.join(boardsDir(), f), 'utf8'));
                    } catch {
                      return null;
                    }
                  })
                  .filter(Boolean)
              : [];
            const compsFile = path.join(dataDir, 'components.json');
            let components: unknown = [];
            try {
              if (fs.existsSync(compsFile)) components = JSON.parse(fs.readFileSync(compsFile, 'utf8'));
            } catch {
              components = [];
            }
            return send(200, JSON.stringify({ boards, components }));
          }
          if (url.startsWith('/board/')) {
            const id = url.slice('/board/'.length).replace(/[^A-Za-z0-9_-]/g, '');
            if (!id) return send(400);
            const file = path.join(boardsDir(), `${id}.json`);
            if (req.method === 'PUT') {
              readBody((body) => {
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
          if (req.method === 'PUT' && url === '/components') {
            readBody((body) => {
              fs.writeFileSync(path.join(dataDir, 'components.json'), body);
              send(200);
            });
            return;
          }
          send(404, '{"error":"not found"}');
        } catch (e) {
          send(500, JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}
