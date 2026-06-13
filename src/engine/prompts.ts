// Built-in starter prompts for common business tasks. Clicking one drops a
// ready-to-run ai: node sticky on the canvas (edit the [brackets], then ▶).
// They run on-brand automatically when a Brand Kit is active.
export interface PromptStarter {
  id: string;
  name: string;
  category: string;
  text: string;
}

export const PROMPT_STARTERS: PromptStarter[] = [
  // ---- Sales & outreach ----
  {
    id: 'cold-email',
    name: 'Cold outreach email',
    category: 'Sales & outreach',
    text: 'ai: Write a short cold email to a [role] at [company] about [your offer]. One line of genuine relevance, one line of value, a soft low-friction CTA. Under 90 words, no fluff, no "hope this finds you well".',
  },
  {
    id: 'follow-up',
    name: 'Follow-up (no reply)',
    category: 'Sales & outreach',
    text: 'ai: Write a friendly 2nd follow-up email to someone who didn\'t reply about [topic]. Keep it 3 sentences, add one new angle or proof point, and give them an easy out.',
  },
  {
    id: 'reengage',
    name: 'Re-engage a cold lead',
    category: 'Sales & outreach',
    text: 'ai: Write a warm re-engagement email to a lead who went quiet [time] ago about [product]. Reference where we left off, share one relevant update, ask if it\'s still a priority.',
  },
  {
    id: 'objection',
    name: 'Handle an objection',
    category: 'Sales & outreach',
    text: 'ai: A prospect said: "[objection]". Write a calm, non-defensive reply that acknowledges it, reframes the value, and proposes a concrete next step.',
  },
  {
    id: 'linkedin-dm',
    name: 'LinkedIn connection note',
    category: 'Sales & outreach',
    text: 'ai: Write a LinkedIn connection request note to a [role] — under 280 characters, specific to why I\'m reaching out, not salesy.',
  },

  // ---- Marketing & content ----
  {
    id: 'value-props',
    name: 'Value propositions',
    category: 'Marketing & content',
    text: 'ai: From this product description, write 3 sharp value propositions aimed at [audience]. Each: a bold benefit headline + one supporting sentence.',
  },
  {
    id: 'hero-copy',
    name: 'Landing page hero',
    category: 'Marketing & content',
    text: 'ai: Write landing-page hero copy for [product]: a headline (≤8 words), a subhead (≤20 words), and a CTA button label. Give 2 variations.',
  },
  {
    id: 'seo-meta',
    name: 'SEO title + meta',
    category: 'Marketing & content',
    text: 'ai: Write an SEO page title (under 60 chars) and a meta description (under 155 chars) for a page about [topic], targeting the keyword "[keyword]".',
  },
  {
    id: 'launch-post',
    name: 'Product launch announcement',
    category: 'Marketing & content',
    text: 'ai: Write a launch announcement for [product/feature] for [channel]. Lead with the customer benefit, one line on what\'s new, and a clear CTA. Excited but not hypey.',
  },
  {
    id: 'repurpose',
    name: 'Repurpose into social',
    category: 'Marketing & content',
    text: 'ai: Turn this content into 3 social posts: one LinkedIn post, one X/Twitter thread (5 tweets), and one short hook for a Reel/TikTok caption.',
  },

  // ---- Customer & ops ----
  {
    id: 'support-reply',
    name: 'Support reply',
    category: 'Customer & ops',
    text: 'ai: Write an empathetic support reply to this customer message. Acknowledge the issue, give the solution or a clear next step, and close warmly. Match the customer\'s level of formality.',
  },
  {
    id: 'meeting-recap',
    name: 'Meeting recap',
    category: 'Customer & ops',
    text: 'ai: Turn these meeting notes into a clean recap: decisions made, action items (owner + due date), and open questions.',
  },
  {
    id: 'weekly-update',
    name: 'Weekly update',
    category: 'Customer & ops',
    text: 'ai: Turn these raw notes into a crisp weekly update for stakeholders: Shipped, In progress, Blockers, Next. Bullet points, no padding.',
  },
  {
    id: 'job-desc',
    name: 'Job description',
    category: 'Customer & ops',
    text: 'ai: Write a job description for a [role] at [company]. Sections: mission, what you\'ll do, must-haves, nice-to-haves. Inclusive, concrete, no buzzwords.',
  },

  // ---- Strategy ----
  {
    id: 'swot',
    name: 'SWOT analysis',
    category: 'Strategy',
    text: 'ai: Do a focused SWOT analysis for [company/idea] in the [market] space. 3–4 concrete points per quadrant, no generic filler.',
  },
  {
    id: 'icp',
    name: 'Define ICP & personas',
    category: 'Strategy',
    text: 'ai: Define the ideal customer profile and 2 buyer personas for [product]. Include firmographics, key pains, triggers to buy, and where to reach them.',
  },
  {
    id: 'positioning',
    name: 'Positioning statement',
    category: 'Strategy',
    text: 'ai: Write a positioning statement for [product] using the format: For [target] who [need], [product] is a [category] that [key benefit], unlike [alternative], because [differentiator].',
  },
];
