// How the dashboard files boards under projects. Pure, so it's testable without
// IndexedDB. The one rule that matters: every live board appears exactly once.
// A board whose project is missing (not restored, deleted elsewhere) or in
// Trash shows under Unfiled — it must never be in storage but on no screen.
import type { BoardMeta, Project } from '../types';

export interface BoardGroups {
  unfiled: BoardMeta[];
  /** live project id -> its live boards (every live project has an entry) */
  byProject: Map<string, BoardMeta[]>;
}

export function groupBoards(boards: BoardMeta[], projects: Project[]): BoardGroups {
  const byProject = new Map<string, BoardMeta[]>();
  for (const p of projects) if (!p.deletedAt) byProject.set(p.id, []);
  const unfiled: BoardMeta[] = [];
  for (const b of boards) {
    if (b.deletedAt) continue;
    const bucket = b.projectId ? byProject.get(b.projectId) : undefined;
    (bucket ?? unfiled).push(b);
  }
  return { unfiled, byProject };
}
