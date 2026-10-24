// "Name on create": the dashboard asks the board it's about to open to focus
// and select its name field once. One-shot, keyed by board id.
const pending = new Set<string>();

export function requestNameOnOpen(boardId: string) {
  pending.add(boardId);
}

/** True once for a board that was just created from the dashboard. */
export function takeNameRequest(boardId: string): boolean {
  return pending.delete(boardId);
}
