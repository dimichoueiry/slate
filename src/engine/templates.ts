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
  return { id: nanoid(8), type: 'text', x, y, w: 200, h: 30, rotation: 0, z: z(), text, color: '#1a1a1a', fontSize: 22, fontFamily: 'hand', fixedWidth: false };
}

function sticky(x: number, y: number, text: string, color = '#FFE066', w = 230, h = 130): StickyObj {
  return { id: nanoid(8), type: 'sticky', x, y, w, h, rotation: 0, z: z(), color, text, fontSize: 15, fontFamily: 'hand' };
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
    id: 'cobblestone-rebrand',
    name: 'Cobblestone Coffee — rebrand',
    description: 'A brand designer board: brand kit + positioning → taglines, logo marks, scorecard.',
    build: () => {
      const head = label(0, 0, 'Cobblestone Coffee — rebrand v3');
      const brand = sticky(
        0,
        60,
        'Brand kit (every node reads this)\nVoice: understated, sensory, not pretentious\nAudience: 30–45 specialty coffee drinkers\nPalette: terracotta · cream · deep green\nType: humanist serif',
        '#FFD6A5',
        266,
        180
      );
      const positioning = sticky(
        0,
        268,
        'Positioning: small-batch, warm, craft — not pretension. "Coffee you take seriously, not snobbishly."',
        '#A8D8EA',
        266,
        140
      );
      const mood = sticky(
        0,
        436,
        'Moodboard: matte kraft packaging, hand-touched marks, warm earth tones, analog feel, slow mornings.',
        '#A8D8EA',
        266,
        140
      );
      const sketch = sticky(
        0,
        604,
        'Logo sketches: 8 rough thumbnails → 3 favorites. Directions: geometric, minimal, one continuous line.',
        '#A8D8EA',
        266,
        140
      );

      const tagNode = sticky(
        COL + 30,
        90,
        'ai: write 3 tagline options for Cobblestone Coffee — understated, sensory, not pretentious. 6 words max each.',
        '#FFE066',
        272,
        170
      );
      const tagOut = sticky(COL * 2 + 60, 90, '', '#B5EAD7', 250, 170);

      const markNode = sticky(
        COL + 30,
        470,
        'img: a coffee-roaster logo mark — geometric, minimal, one continuous line. Palette: terracotta, cream, deep green. Flat vector, no text.',
        '#FFE066',
        272,
        200
      );
      const markOut = sticky(COL * 2 + 60, 470, '', '#B5EAD7', 250, 200);

      return [
        head,
        brand,
        positioning,
        mood,
        sketch,
        tagNode,
        tagOut,
        markNode,
        markOut,
        connect(brand, tagNode),
        connect(positioning, tagNode),
        connect(tagNode, tagOut),
        connect(brand, markNode),
        connect(mood, markNode),
        connect(sketch, markNode),
        connect(markNode, markOut),
      ];
    },
  },
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
  {
    id: 'linkedin-brand',
    name: 'LinkedIn personal brand',
    description: 'Angle → research → post draft → carousel cover (on-brand).',
    build: () => {
      const head = label(0, 0, 'LinkedIn personal brand');
      const angle = sticky(0, 60, 'your angle or topic for this week', '#A8D8EA', 220, 110);
      const research = sticky(COL, 60, 'research: what is resonating on LinkedIn about this topic right now — angles, data, contrarian takes', '#FFE066', 250, 170);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const draft = sticky(COL * 3, 60, 'ai: write a first-person LinkedIn post — strong hook line, one idea, short lines, a little contrarian, end with a question. No hashtags.', '#FFE066', 250, 190);
      const post = sticky(COL * 4, 60, '', '#B5EAD7', 250, 200);
      const cover = sticky(COL * 4, 280, 'img: a clean, minimal LinkedIn carousel cover for this post', '#E2C2FF', 250, 130);
      return [
        head,
        angle,
        research,
        mid,
        draft,
        post,
        cover,
        connect(angle, research),
        connect(research, mid),
        connect(mid, draft),
        connect(draft, post),
        connect(post, cover),
      ];
    },
  },
  {
    id: 'instagram-growth',
    name: 'Grow on Instagram',
    description: 'Niche → trends → 5 post/Reel ideas → on-brand visual.',
    build: () => {
      const head = label(0, 0, 'Grow on Instagram');
      const niche = sticky(0, 60, 'your niche / account theme', '#A8D8EA', 220, 110);
      const trends = sticky(COL, 60, 'research: trending Instagram formats, hooks, and Reel ideas in this niche right now', '#FFE066', 250, 160);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const ideas = sticky(COL * 3, 60, 'ai: give 5 post/Reel ideas — each with a scroll-stopping hook, a 1-line caption, and 8 relevant hashtags', '#FFE066', 250, 190);
      const out = sticky(COL * 4, 60, '', '#B5EAD7', 250, 200);
      const visual = sticky(COL * 4, 280, 'img: an on-brand Instagram post visual for the first idea', '#E2C2FF', 250, 130);
      return [
        head,
        niche,
        trends,
        mid,
        ideas,
        out,
        visual,
        connect(niche, trends),
        connect(trends, mid),
        connect(mid, ideas),
        connect(ideas, out),
        connect(out, visual),
      ];
    },
  },
  {
    id: 'blog-writer',
    name: 'Blog post writer',
    description: 'Topic → research → outline → full SEO-aware draft.',
    build: () => {
      const head = label(0, 0, 'Blog post writer');
      const topic = sticky(0, 60, 'blog topic + target keyword', '#A8D8EA', 220, 110);
      const research = sticky(COL, 60, 'research: key facts, stats, subtopics, and search intent for this topic', '#FFE066', 250, 160);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const outline = sticky(COL * 3, 60, 'ai: build a blog outline — title options, H2 sections, and one-line notes per section, SEO-aware', '#FFE066', 250, 170);
      const outlineOut = sticky(COL * 4, 60, '', '#F1F0EC', 240, 170);
      const draft = sticky(COL * 5, 60, 'ai: write the full blog post from the outline — clear intro, the H2 sections, and a takeaways box', '#FFE066', 250, 190);
      const final = sticky(COL * 6, 60, '', '#B5EAD7', 260, 220);
      return [
        head,
        topic,
        research,
        mid,
        outline,
        outlineOut,
        draft,
        final,
        connect(topic, research),
        connect(research, mid),
        connect(mid, outline),
        connect(outline, outlineOut),
        connect(outlineOut, draft),
        connect(draft, final),
      ];
    },
  },
  {
    id: 'twitter-thread',
    name: 'X / Twitter thread',
    description: 'Idea → research → a punchy 7-tweet thread.',
    build: () => {
      const head = label(0, 0, 'X / Twitter thread');
      const idea = sticky(0, 60, 'your thread idea or claim', '#A8D8EA', 220, 110);
      const research = sticky(COL, 60, 'research: supporting facts, examples, and counterpoints for this claim', '#FFE066', 250, 160);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const thread = sticky(COL * 3, 60, 'ai: write a 7-tweet thread — tweet 1 is a bold hook, each tweet ≤270 chars, last tweet a CTA. Number them.', '#FFE066', 250, 190);
      const out = sticky(COL * 4, 60, '', '#B5EAD7', 250, 220);
      return [head, idea, research, mid, thread, out, connect(idea, research), connect(research, mid), connect(mid, thread), connect(thread, out)];
    },
  },
  {
    id: 'youtube-script',
    name: 'YouTube video script',
    description: 'Topic → research → title + hook + full script.',
    build: () => {
      const head = label(0, 0, 'YouTube video script');
      const topic = sticky(0, 60, 'video topic / working title', '#A8D8EA', 220, 110);
      const research = sticky(COL, 60, 'research: what viewers want to know about this topic — angles, common questions, examples', '#FFE066', 250, 160);
      const mid = sticky(COL * 2, 60, '', '#F1F0EC', 240, 150);
      const script = sticky(COL * 3, 60, 'ai: write a YouTube script — 3 clickable title options, a 15-second hook, then a structured script with sections', '#FFE066', 250, 190);
      const out = sticky(COL * 4, 60, '', '#B5EAD7', 260, 220);
      const thumb = sticky(COL * 4, 300, 'img: a bold, high-contrast YouTube thumbnail concept for this video', '#E2C2FF', 250, 130);
      return [
        head,
        topic,
        research,
        mid,
        script,
        out,
        thumb,
        connect(topic, research),
        connect(research, mid),
        connect(mid, script),
        connect(script, out),
        connect(out, thumb),
      ];
    },
  },
  {
    id: 'character-generation',
    name: 'Character generation',
    description: 'Describe a character once → 8 pose cards, each generating one on-model pixel sprite.',
    build: () => {
      const head = label(0, 0, 'Character generation — one prompt, one sprite');
      const brief = sticky(
        0,
        60,
        'CHARACTER + STYLE BRIEF — wired into every pose card →\n\n== CHARACTER (replace with yours) ==\nA young knight hero: cyan rounded helmet, light-blue chest armor over a navy bodysuit, dark navy gloves and boots, round wooden shield with an iron rim, a short broadsword with an orange hilt. Determined face, big expressive eyes.\n\n== STYLE (edit once, applies to all) ==\n16-bit pixel art, SNES-era feel: chunky 2–3 px outlines, limited 16-color palette with cel shading, no anti-aliasing, subtle dithering, clean readable silhouette, heroic 2:3 head-to-body proportions.',
        '#BFDBFE',
        320,
        430
      );
      const howTo = sticky(
        0,
        520,
        'HOW TO USE\n\n1. Edit the blue brief so it describes YOUR character.\n2. Press ▶ on any teal pose card — it generates ONE sprite beside the card.\n3. Rerun to reroll. For the next animation frame, edit only the card’s last POSE line and run again.\n\nStronger likeness: drop your reference image on the board and wire it INTO each pose card — anything wired in is fed to the generator.',
        '#FDE68A',
        320,
        330
      );

      const POSE_PROMPT =
        'img: ONE pixel-art game sprite of the wired character, in the wired style, exactly one full-body character centered on a plain white background, no text, no grid.\n\nPOSE — ';
      const poses = [
        'IDLE: standing upright and relaxed, facing right, feet shoulder-width apart, arms at sides, sword sheathed.',
        'WALK frame 1: mid-stride walking to the right, right foot forward, arms swinging naturally, relaxed pace.',
        'RUN frame 1: full sprint to the right, body leaning forward, both knees bent high, arms pumping.',
        'JUMP: airborne, knees tucked up, one arm raised, facing right, clearly off the ground.',
        'ATTACK: mid sword-swing to the right, blade arcing overhead, shield arm tucked back, wide action stance.',
        'BLOCK: crouched guard stance facing right, shield raised in front covering the torso, sword held low behind.',
        'HURT: recoiling from a hit, knocked back to the left, eyes squeezed shut, arms flailing, off balance.',
        'VICTORY: facing the viewer, sword raised triumphantly overhead, other fist on hip, big happy grin.',
      ];
      const cards = poses.map((p, i) =>
        sticky(380 + (i % 4) * 320, 60 + Math.floor(i / 4) * 320, POSE_PROMPT + p, '#99F6E4', 290, 290)
      );
      return [head, brief, howTo, ...cards, ...cards.map((c) => connect(brief, c))];
    },
  },
  {
    id: 'animation-strips',
    name: 'Animation strips',
    description: 'One character brief → runnable cards that each generate a full animation sprite strip.',
    build: () => {
      const head = label(0, 0, 'Animation strips — one run, one movement sheet');
      const brief = sticky(
        0,
        60,
        'CHARACTER + STYLE BRIEF — wired into every strip card →\n\n== CHARACTER (replace with yours) ==\nA young knight hero: cyan rounded helmet, light-blue chest armor over a navy bodysuit, dark navy gloves and boots, round wooden shield with an iron rim, a short broadsword with an orange hilt. Determined face, big expressive eyes.\n\n== STYLE (edit once, applies to all) ==\n16-bit pixel art, SNES-era feel: chunky 2–3 px outlines, limited 16-color palette with cel shading, no anti-aliasing, subtle dithering, clean readable silhouette, heroic 2:3 head-to-body proportions.',
        '#BFDBFE',
        320,
        430
      );
      const howTo = sticky(
        0,
        520,
        'HOW TO USE\n\n1. Edit the blue brief to YOUR character. Wire your reference image into each card for a stronger likeness.\n2. Press ▶ on a card — one run = one full strip.\n3. Frame counts are editable: change “EXACTLY 6 frames” to 8 for smoother cycles.\n\nReality check: strips are rarely perfectly grid-aligned — expect to re-slice in a sprite editor (Aseprite, Piskel). If one frame breaks character, reroll or patch in a single pose.',
        '#FDE68A',
        320,
        360
      );

      const strip = (frames: number, movement: string) =>
        `img: A pixel-art animation sprite sheet of the wired character, in the wired style: EXACTLY ${frames} frames of the same character in one single horizontal row, all frames identical in size and proportions, evenly spaced as equal invisible cells, plain white background, no grid lines, no borders, no text, no numbers.\n\nMOVEMENT — ${movement}`;
      const movements: [number, string][] = [
        [6, 'WALK CYCLE (loops): 1 right foot forward touching ground · 2 weight on right leg, body at its lowest · 3 legs passing together, body rising · 4 left foot forward touching ground · 5 weight on left leg, body lowest · 6 legs passing, body rising. Arms swing opposite the legs, slight up-down bob.'],
        [6, 'RUN CYCLE (loops): 1 push-off with a deep forward lean · 2 airborne, legs split wide mid-stride · 3 right foot lands, knee bent · 4 push-off again · 5 airborne, legs swapped · 6 left foot lands. Fists pumping opposite the legs; more lean and longer stride than a walk.'],
        [5, 'JUMP ARC (plays once): 1 crouch, knees bent deep in anticipation · 2 launch, body stretched tall, arms thrown up · 3 apex, knees tucked under · 4 falling, legs reaching down, arms raised · 5 landing crouch, absorbing the impact.'],
        [4, 'SWORD ATTACK (plays once): 1 windup, sword pulled back over the shoulder, shield tucked · 2 swing, blade arcing overhead · 3 follow-through, blade fully down in front, body twisted into it · 4 recover back to guard stance.'],
        [4, 'HURT & KNOCKDOWN (plays once): 1 impact flinch, head snapped back · 2 knocked backward, off balance, arms flailing · 3 falling, body tilted, feet leaving the ground · 4 down on the ground, dazed.'],
        [4, 'IDLE BREATHING (loops, subtle): 1 neutral stance · 2 inhale, chest and shoulders rise slightly · 3 peak of the breath, head one pixel higher · 4 settle back to neutral. Keep the changes between frames tiny — this loop should feel calm.'],
      ];
      const cards = movements.map(([frames, movement], i) =>
        sticky(380 + (i % 2) * 500, 60 + Math.floor(i / 2) * 330, strip(frames, movement), '#99F6E4', 470, 310)
      );
      return [head, brief, howTo, ...cards, ...cards.map((c) => connect(brief, c))];
    },
  },
];
