// Starter brand-kit presets — used by onboarding and the kit editor so users
// can pick "what's this for?" instead of filling a blank kit.
export interface BrandPreset {
  id: string;
  name: string;
  emoji: string;
  voice: string;
  audience: string;
  donts: string;
  palette: string[];
}

export const BRAND_PRESETS: BrandPreset[] = [
  {
    id: 'personal',
    name: 'Personal brand',
    emoji: '🙋',
    voice: 'First-person, opinionated, conversational. Short punchy sentences, a strong hook, a little contrarian. Sound like a real person, not a brand.',
    audience: 'my followers and professional network',
    donts: 'corporate jargon, hype words, overusing emojis, "hope this finds you well"',
    palette: ['#1a1a1a', '#3c78ff'],
  },
  {
    id: 'business',
    name: 'Business / marketing',
    emoji: '💼',
    voice: 'Clear, benefit-led, confident but never hypey. Concrete and specific, customer-focused.',
    audience: 'prospective customers and buyers',
    donts: 'jargon, fluff, exclamation marks, vague claims',
    palette: ['#1971c2', '#1a1a1a'],
  },
  {
    id: 'creative',
    name: 'Creative',
    emoji: '🎨',
    voice: 'Expressive, vivid, playful. Bold language and strong imagery; take stylistic risks.',
    audience: 'a creative, design-savvy audience',
    donts: 'corporate tone, blandness, hedging',
    palette: ['#e64980', '#6741d9', '#f08c00'],
  },
  {
    id: 'general',
    name: 'General',
    emoji: '✶',
    voice: 'Neutral, clear, and helpful. No particular spin or persona.',
    audience: 'a general audience',
    donts: '',
    palette: [],
  },
];
