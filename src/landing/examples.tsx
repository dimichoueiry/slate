import { TEMPLATES } from '../engine/templates';
import { type RScene } from './RunnableBoard';
import { sceneFromObjects } from './sceneAdapter';
import { Bullets, Doc, Photo } from './outputs';
import cobblestoneLogo from './assets/cobblestone-logo.png';
import kidHorseInput from './assets/kid-horse-input.png';
import kidHorseFunky from './assets/kid-horse-funky.png';
import kidHorseDylan from './assets/kid-horse-dylan.png';
import ytThumb1 from './assets/yt-thumb-1.png';
import ytThumb2 from './assets/yt-thumb-2.png';

/* Real, runnable example boards for the hero dashboard.
   Each is a genuine little workflow: context wired into AI nodes you can run.
   To add one: copy a scene, change the notes/prompts, and pick an output
   component from ./outputs (Bars, Bullets, Pills, TableOut, Copy, ImageOut). */

/* ── Kid's drawing → finished art ─────────────────────────────────────────
   A line-art doodle becomes a colorful kid drawing (shape kept, made funky),
   then a second img node adds a messy "Dylan" signature. Image in → image out,
   chained — outputs render bare (no sticky behind them). */
export const kidDrawingScene: RScene = {
  id: 'kid-drawing',
  name: "Kid's drawing",
  // a clean left→right pipeline with aligned vertical centers, so connectors
  // run nearly straight (no diagonal swoops).
  notes: [{ id: 'doodle', x: 40, y: 90, w: 250, h: 210, img: kidHorseInput }],
  nodes: [
    {
      id: 'funkNode',
      x: 360,
      y: 140,
      w: 250,
      h: 110,
      cmd: 'img:',
      rest: 'turn this into a hand-drawn kid drawing — keep the shape, make it funky',
      inputs: ['doodle'],
      out: {
        id: 'funkyOut',
        x: 680,
        y: 85,
        w: 262,
        h: 222,
        title: '',
        bare: true,
        render: (a) => <Photo anim={a} src={kidHorseFunky} />,
      },
    },
    {
      id: 'signNode',
      x: 1012,
      y: 140,
      w: 250,
      h: 110,
      cmd: 'img:',
      rest: 'write "Dylan" at the bottom, like a messy kid signature',
      inputs: ['funkyOut'],
      out: {
        id: 'dylanOut',
        x: 1332,
        y: 70,
        w: 262,
        h: 252,
        title: '',
        bare: true,
        render: (a) => <Photo anim={a} src={kidHorseDylan} />,
      },
    },
  ],
};

/* ── YouTube video script → thumbnail ─────────────────────────────────────
   Topic → audience research → full script → a YouTube thumbnail (informed by a
   separate "what makes a great thumbnail" research note), then a second img
   node refines that thumbnail. Outputs are the real long text (clamped with a
   "Show more · N words" pill) and real generated images. */
const YT_CONCEPTS = `### Core Concepts and Common Beginner Questions
*  **How they work:** Neural networks process data through layers of interconnected nodes. They "learn" by adjusting weights based on input, "evaluate" their accuracy through backpropagation, and "use" the refined patterns to make decisions and predictions.
*  **Effective analogies:** Viewers grasp the concept best when networks are`;

const YT_SCRIPT = `Title Options:
1. Neural Networks Explained Simply (How AI Learns)
2. Stop Coding, Start Training: Neural Networks for Beginners
3. The Hidden AI Running Your Life: Neural Networks 101

Hook (15 seconds):
What if I told you the AI taking over the world isn't magic? It is just a giant web of math trying to guess the right answer. In the next few minutes, you will understand exactly how neural`;

const YT_FRAMEWORK = `## Core Framework Overview
- **Mobile-first design:** Prioritize clarity and impact on small screens, as mobile viewing dictates performance.
- **One dominant subject:** Limit the composition to a single focal point to avoid clutter.
- **Strict color palette:** Use only two or three colors with high contrast to make the thumbnail pop.
- **Instant value promise:** The thumbnail must immediately communicate what the viewer will learn or gain.`;

export const youtubeScene: RScene = {
  id: 'youtube',
  name: 'YouTube video script',
  notes: [{ id: 'topic', x: 40, y: 130, w: 210, h: 110, color: '#A8D8EA', body: 'artificial neural networks' }],
  nodes: [
    {
      id: 'researchNode',
      x: 320,
      y: 120,
      w: 252,
      h: 132,
      cmd: 'research:',
      rest: 'what viewers want to know about this topic — angles, common questions, examples',
      inputs: ['topic'],
      out: {
        id: 'concepts',
        x: 640,
        y: 100,
        w: 252,
        h: 210,
        title: '',
        color: '#FFE066',
        render: (a) => <Doc anim={a} text={YT_CONCEPTS} words={633} />,
      },
    },
    {
      id: 'scriptNode',
      x: 960,
      y: 120,
      w: 262,
      h: 150,
      cmd: 'ai:',
      rest: 'write a YouTube script — 3 clickable title options, a 15-second hook, then a structured script with sections',
      inputs: ['concepts'],
      out: {
        id: 'titles',
        x: 1300,
        y: 100,
        w: 262,
        h: 210,
        title: '',
        color: '#B5EAD7',
        render: (a) => <Doc anim={a} text={YT_SCRIPT} words={486} />,
      },
    },
    {
      id: 'frameworkNode',
      x: 320,
      y: 560,
      w: 262,
      h: 152,
      cmd: 'research:',
      rest: 'what is the best framework of how an explainer video youtube thumbnail should look like in 2026?',
      inputs: [],
      out: {
        id: 'framework',
        x: 640,
        y: 540,
        w: 262,
        h: 220,
        title: '',
        color: '#A8D8EA',
        render: (a) => <Doc anim={a} text={YT_FRAMEWORK} words={642} />,
      },
    },
    {
      id: 'thumbNode',
      x: 1640,
      y: 330,
      w: 258,
      h: 120,
      cmd: 'img:',
      rest: 'YouTube thumbnail concept for this video',
      inputs: ['titles', 'framework'],
      out: {
        id: 'thumb1',
        x: 1960,
        y: 300,
        w: 280,
        h: 210,
        title: '',
        bare: true,
        render: (a) => <Photo anim={a} src={ytThumb1} />,
      },
    },
    {
      id: 'refineNode',
      x: 1960,
      y: 620,
      w: 262,
      h: 158,
      cmd: 'img:',
      rest: "remove the 'NETS', the arrow, and the browser icon with X UNDER 'Neural Nets' and add a 'nets' sticky note instead. make sure it is well placed",
      inputs: ['thumb1'],
      out: {
        id: 'thumb2',
        x: 2280,
        y: 600,
        w: 280,
        h: 220,
        title: '',
        bare: true,
        render: (a) => <Photo anim={a} src={ytThumb2} />,
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
