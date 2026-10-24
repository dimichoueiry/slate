// Dev-only persistence: mirrors boards/projects/components from the browser's IndexedDB
// into ./data as plain JSON files, and restores them on startup — so your work
// survives origin/port changes, browser-storage wipes, anything.
import { loadEnv, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { scrapeUrls } from './api/scrape';
import { searchWeb } from './api/search';
import { proxyFetch } from './api/fetch';
import { createMirrorHandler } from './vite-slate-mirror';

export default function slatePersist(): Plugin {
  let dataDir = '';

  return {
    name: 'slate-persist',
    apply: 'serve', // dev server only — ./data file-mirror + dev routing for /api functions
    configResolved(config) {
      dataDir = path.join(config.root, 'data');
      fs.mkdirSync(path.join(dataDir, 'boards'), { recursive: true });
      // load .env (incl. non-VITE_ vars) into process.env so the /api functions
      // read the same key in dev as they will from Vercel env vars in prod
      const env = loadEnv(config.mode || 'development', config.root, '');
      if (env.TAVILY_API_KEY && !process.env.TAVILY_API_KEY) {
        process.env.TAVILY_API_KEY = env.TAVILY_API_KEY;
      }
    },
    configureServer(server) {
      // serve the real /api/scrape function in dev (mirrors Vercel's /api routing)
      server.middlewares.use('/api/scrape', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('{"error":"Method not allowed"}');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let urls: unknown = [];
          try {
            urls = JSON.parse(body || '{}').urls;
          } catch {
            urls = [];
          }
          const { status, body: out } = await scrapeUrls(urls);
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
        });
      });
      server.middlewares.use('/api/search', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('{"error":"Method not allowed"}');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let query: unknown = '';
          try {
            query = JSON.parse(body || '{}').query;
          } catch {
            query = '';
          }
          const { status, body: out } = await searchWeb(query);
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
        });
      });
      server.middlewares.use('/api/fetch', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('{"error":"Method not allowed"}');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(body || '{}');
          } catch {
            parsed = {};
          }
          const { status, body: out } = await proxyFetch(parsed);
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
        });
      });
      server.middlewares.use('/api/research', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('{"error":"Method not allowed"}');
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let parsed: any = {};
          try {
            parsed = JSON.parse(body || '{}');
          } catch {
            parsed = {};
          }
          // lazy-load so LangGraph isn't pulled in at dev-server startup
          const { runResearch } = await import('./api/research');
          const { status, body: out } = await runResearch(parsed.query, parsed.apiKey, parsed.model, parsed.synthesisPrompt);
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(out));
        });
      });

      server.middlewares.use('/__slate', createMirrorHandler(dataDir));
    },
  };
}
