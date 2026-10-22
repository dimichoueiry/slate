// Run the app's unit tests (tests/*.test.ts) under node:test. esbuild (already
// installed with Vite) bundles each file so the tests import real src/ modules.
// Usage: npm test
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outdir = path.join(root, 'node_modules', '.cache', 'unit-tests');
fs.rmSync(outdir, { recursive: true, force: true });

const entries = fs
  .readdirSync(path.join(root, 'tests'))
  .filter((f) => f.endsWith('.test.ts'))
  .map((f) => path.join(root, 'tests', f));

await build({
  entryPoints: entries,
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
});

const files = fs.readdirSync(outdir).filter((f) => f.endsWith('.mjs')).map((f) => path.join(outdir, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
