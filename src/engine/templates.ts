// Pre-wired business flow templates. Each build() returns a self-contained
// bundle of objects (input stickies + ai/web/search/extract/img nodes +
// connectors) laid out around the origin; the controller centers it in view.
import { nanoid } from 'nanoid';
import type { SlateObj, StickyObj, TextObj, ConnectorObj } from '../types';

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  build: () => SlateObj[];
}

let zc = 1;
const z = () => zc++;

function label(x: number, y: number, text: string): TextObj {
  return { id: nanoid(8), type: 'text', x, y, w: 200, h: 30, rotation: 0, z: z(), text, color: '#1a1a1a', fontSize: 22, fontFamily: 'sans', fixedWidth: false };
}

function sticky(x: number, y: number, text: string, color = '#FFE066', w = 230, h = 130): StickyObj {
  return { id: nanoid(8), type: 'sticky', x, y, w, h, rotation: 0, z: z(), color, text, fontSize: 15, fontFamily: 'sans' };
}

function connect(from: SlateObj, to: SlateObj): ConnectorObj {
  return {
    id: nanoid(8),
    type: 'connector',
    x: from.x,
    y: from.y,
    rotation: 0,
    z: z(),
    from: { objectId: from.id },
    to: { objectId: to.id },
    routing: 'curved',
    stroke: '#868e96',
    strokeWidth: 2,
    dash: 'solid',
    startArrow: 'none',
    endArrow: 'triangle',
    opacity: 1,
  };
}

const COL = 330; // horizontal spacing between stages

export const TEMPLATES: TemplateDef[] = [
  {
    id: 'lead-qualifier',
    name: 'Lead qualifier',
    description: 'A company URL → scrape → ICP fit assessment.',
    build: () => {
      const head = label(0, 0, 'Lead qualifier');
      const input = sticky(0, 60, 'https://stripe.com', '#A8D8EA');
      const node = sticky(
        COL,
        60,
        'web: Describe this company and assess fit for our ICP (B2B SaaS, 10–200 employees). Output: what they do · ICP fit (yes/no) · why.',
        '#FFE066',
        260,
        180
      );
      return [head, input, node, connect(input, node)];
    },
  },
  {
    id: 'competitor-matrix',
    name: 'Competitor matrix',
    description: 'Your product → find competitors → comparison table.',
    build: () => {
      const head = label(0, 0, 'Competitor matrix');
      const input = sticky(0, 60, 'Notion', '#A8D8EA', 200, 90);
      const search = sticky(COL, 60, 'search: top competitors and alternatives to the input product, with their websites', '#FFE066', 240, 150);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const extract = sticky(
        COL * 3,
        60,
        'extract: each competitor — name, positioning, pricing, key differentiator',
        '#FFE066',
        250,
        150
      );
      return [head, input, search, mid, extract, connect(input, search), connect(search, mid), connect(mid, extract)];
    },
  },
  {
    id: 'content-engine',
    name: 'Content engine',
    description: 'Topic → research → post draft → hero image.',
    build: () => {
      const head = label(0, 0, 'Content engine');
      const topic = sticky(0, 60, 'the rise of local-first software', '#A8D8EA', 220, 100);
      const research = sticky(COL, 60, 'search: recent facts, stats, and angles on the topic', '#FFE066', 230, 130);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 230, 130);
      const post = sticky(COL * 3, 60, 'ai: write an engaging, non-cliché LinkedIn post using the research', '#FFE066', 240, 150);
      const draft = sticky(COL * 4, 60, '', '#B5EAD7', 240, 160);
      const hero = sticky(COL * 4, 250, 'img: a clean, modern hero image for this post', '#E2C2FF', 240, 130);
      return [
        head,
        topic,
        research,
        mid,
        post,
        draft,
        hero,
        connect(topic, research),
        connect(research, mid),
        connect(mid, post),
        connect(post, draft),
        connect(draft, hero),
      ];
    },
  },
  {
    id: 'interview-synth',
    name: 'Interview synthesizer',
    description: 'Several interview notes → themes, pains, quotes.',
    build: () => {
      const head = label(0, 0, 'Interview synthesizer');
      const i1 = sticky(0, 60, 'Interview 1 notes…', '#A8D8EA', 220, 150);
      const i2 = sticky(0, 230, 'Interview 2 notes…', '#A8D8EA', 220, 150);
      const i3 = sticky(0, 400, 'Interview 3 notes…', '#A8D8EA', 220, 150);
      const node = sticky(
        COL,
        200,
        'ai: synthesize the top themes, recurring pain points, and 3 notable verbatim quotes across these interviews',
        '#FFE066',
        260,
        200
      );
      return [head, i1, i2, i3, node, connect(i1, node), connect(i2, node), connect(i3, node)];
    },
  },
];
