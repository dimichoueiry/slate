import { TEMPLATES } from '../engine/templates';
import { type RScene } from './RunnableBoard';
import { sceneFromObjects } from './sceneAdapter';
import { Bars, Bullets, Copy, Photo } from './outputs';
import cobblestoneLogo from './assets/cobblestone-logo.png';

/* Real, runnable example boards for the hero dashboard.
   Each is a genuine little workflow: context wired into AI nodes you can run.
   To add one: copy a scene, change the notes/prompts, and pick an output
   component from ./outputs (Bars, Bullets, Pills, TableOut, Copy, ImageOut). */

/* ── Competitor teardown → positioning ───────────────────────────────────
   Premise: notes on three rivals. Run the first agent to find where you
   actually win; those angles feed a second agent that writes the one-liner. */
export const competitorScene: RScene = {
  id: 'competitors',
  name: 'Competitor teardown',
  notes: [
    { id: 'notion', x: 40, y: 36, w: 196, h: 96, color: '#FFD6A5', title: 'Rival · Notion', body: 'Docs + databases are strong.\nCanvas feels bolted on.' },
    { id: 'miro', x: 40, y: 146, w: 196, h: 96, color: '#B5EAD7', title: 'Rival · Miro', body: 'Best-in-class canvas.\nNo AI that does the work.' },
    { id: 'tldraw', x: 40, y: 256, w: 196, h: 96, color: '#A8D8EA', title: 'Rival · tldraw', body: 'Gorgeous, open-source.\nDrawing only — no data.' },
  ],
  nodes: [
    {
      id: 'winNode',
      x: 316,
      y: 156,
      w: 250,
      h: 64,
      cmd: 'ai:',
      rest: 'where do we actually win?',
      inputs: ['notion', 'miro', 'tldraw'],
      out: {
        id: 'angles',
        x: 316,
        y: 300,
        w: 258,
        h: 160,
        title: 'Positioning',
        file: 'positioning.md',
        render: (a) => (
          <Bullets
            anim={a}
            items={[
              'Only canvas where agents do the work — not just chat.',
              'Freeform ideas + structured data on one page.',
              'Local-first and fast — no enterprise tax.',
            ]}
          />
        ),
      },
    },
    {
      id: 'lineNode',
      x: 656,
      y: 332,
      w: 244,
      h: 64,
      cmd: 'ai:',
      rest: 'turn it into a one-liner',
      inputs: ['angles'],
      out: {
        id: 'tagline',
        x: 656,
        y: 472,
        w: 272,
        h: 122,
        title: 'Tagline',
        file: 'tagline.md',
        render: (a) => (
          <Copy
            anim={a}
            lead="The canvas that does the work."
            body="Freeform ideas in, finished work out — agents on an infinite, local-first page."
          />
        ),
      },
    },
  ],
};

/* ── Receiptly · Launch board ─────────────────────────────────────────────
   Maya, solo founder, 3 weeks from a Product Hunt launch — pitch, launch plan
   and a private fallback on one offline canvas. Positioning + a sketched
   product flow feed an `ai:` hero-copy node, which chains into a `research:`
   investor 1-pager; a separate `chart:` node projects MRR from her launch
   loop. The pivot idea stays in a private sticky that never leaves her Mac. */
export const receiptlyScene: RScene = {
  id: 'receiptly',
  name: 'Launch board',
  notes: [
    { id: 'pos1', x: 40, y: 40, w: 192, h: 86, color: '#FFD6A5', title: 'Positioning', body: '“Expensify for people\nwho hate Expensify.”' },
    { id: 'pos2', x: 40, y: 140, w: 192, h: 86, color: '#B5EAD7', title: 'Other angles', body: 'Receipts that file\nthemselves.' },
    { id: 'flow', x: 40, y: 240, w: 192, h: 92, color: '#A8D8EA', title: 'Product flow (sketch)', body: '📷 → OCR → categories\n→ tax-ready PDF' },
    { id: 'week', x: 300, y: 470, w: 192, h: 86, color: '#FFD6A5', title: 'Launch loop', body: 'PH → 3 newsletters →\nr/freelance → SEO' },
    { id: 'private', x: 612, y: 120, w: 208, h: 96, color: '#F2D3D3', title: '🔒 Private · this Mac', body: 'If flat by week 6 → pivot\nWhatsApp-first, LATAM.' },
  ],
  nodes: [
    {
      id: 'heroNode',
      x: 300,
      y: 120,
      w: 244,
      h: 60,
      cmd: 'ai:',
      rest: 'write 3 hero options — dry, confident, a bit irreverent',
      inputs: ['pos1', 'pos2', 'flow'],
      out: {
        id: 'heroes',
        x: 300,
        y: 258,
        w: 256,
        h: 150,
        title: 'Hero options',
        file: 'hero.md',
        render: (a) => (
          <Bullets
            anim={a}
            items={[
              'Point, shoot, deduct.',
              'Every receipt is a write-off you’re forgetting.',
              'Bookkeeping for people who’d rather be working.',
            ]}
          />
        ),
      },
    },
    {
      id: 'investNode',
      x: 612,
      y: 300,
      w: 244,
      h: 60,
      cmd: 'research:',
      rest: 'turn the winner into a 1-page investor summary',
      inputs: ['heroes'],
      out: {
        id: 'summary',
        x: 612,
        y: 438,
        w: 268,
        h: 184,
        title: 'Investor 1-pager',
        file: 'pitch.md',
        render: (a) => (
          <Bullets
            anim={a}
            items={[
              'Problem: freelancers lose ~$1.2k/yr in missed write-offs.',
              'Market: 70M+ solo freelancers, no tool built for them.',
              'Why now: on-device OCR is finally good enough.',
              'Plan: Product Hunt → niche newsletters → SEO.',
            ]}
          />
        ),
      },
    },
    {
      id: 'mrrNode',
      x: 300,
      y: 580,
      w: 244,
      h: 60,
      cmd: 'chart:',
      rest: 'project MRR for the first 12 weeks',
      inputs: ['week'],
      out: {
        id: 'mrr',
        x: 300,
        y: 718,
        w: 256,
        h: 150,
        title: 'MRR projection',
        file: 'mrr.svg',
        render: (a) => (
          <Bars
            anim={a}
            rows={[
              ['Wk 2', 1],
              ['Wk 4', 2],
              ['Wk 6', 4],
              ['Wk 8', 7],
              ['Wk 12', 12],
            ]}
          />
        ),
      },
    },
  ],
};

/* ── Cobblestone Coffee · rebrand v3 ──────────────────────────────────────
   The board itself is the REAL app template (src/engine/templates.ts) — one
   source of truth, shared with the app's Flow-templates picker. Here we only
   supply the canned outputs (in board order of the AI nodes: ai → img),
   since the live ones would come from an LLM. */
const cobTemplate = TEMPLATES.find((t) => t.id === 'cobblestone-rebrand')!;
export const cobblestoneScene: RScene = sceneFromObjects(
  cobTemplate.build(),
  [
    // ai: taglines
    (a) => <Bullets anim={a} items={['Slow-roasted, quietly bold.', 'Small batch. Steady hands. Warm cups.', 'Roasted with hands, not hurry.']} />,
    // img: the generated logo
    (a) => <Photo anim={a} src={cobblestoneLogo} />,
  ],
  { id: 'cobblestone', name: 'Cobblestone rebrand' },
);
