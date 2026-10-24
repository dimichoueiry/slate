// "Edited 2h ago"-style timestamps for the dashboard. Pure (pass `now`) so it's
// testable and every card on screen agrees on the same clock tick.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < MIN) return 'just now'; // also covers small clock skew into the future
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  const days = Math.floor(diff / DAY);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Full timestamp for the tooltip, minutes precision (no seconds). */
export function fullTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
