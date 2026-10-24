// Trash: soft-deleted boards and projects. Restore puts them back as they
// were; "Delete forever" is the only path to a real delete (and, with Git
// Sync on, the only thing that removes a board from the repo).
import type { BoardMeta, Project } from '../types';
import { deleteBoard, deleteProject, restoreBoard, restoreProject } from '../store/db';
import { fullTime, relativeTime } from '../store/relativeTime';
import { useGitSync } from '../store/gitsync/engine';
import { confirmDialog, toast } from './Dialogs';
import { Folder } from 'lucide-react';

interface Props {
  boards: BoardMeta[];
  projects: Project[];
  liveProjects: Project[];
  now: number;
  refresh: () => void;
}

export default function TrashView({ boards, projects, liveProjects, now, refresh }: Props) {
  const syncing = useGitSync((s) => s.status !== 'off');
  const empty = boards.length === 0 && projects.length === 0;
  const projName = (id: string | null | undefined) =>
    [...liveProjects, ...projects].find((p) => p.id === id)?.name ?? null;

  const restoreB = async (b: BoardMeta) => {
    await restoreBoard(b.id);
    refresh();
    const proj = b.projectId ? liveProjects.find((p) => p.id === b.projectId) : undefined;
    toast(`Restored “${b.name}”${proj ? ` to ${proj.name}` : ''}.`);
  };

  const deleteB = async (b: BoardMeta) => {
    const ok = await confirmDialog({
      title: `Delete “${b.name}” forever?`,
      body: `This can't be undone.${syncing ? ' Git Sync will also remove it from your repo and your other machines.' : ''}`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    await deleteBoard(b.id);
    refresh();
    toast(`Deleted “${b.name}” forever.`);
  };

  const restoreP = async (p: Project) => {
    await restoreProject(p.id);
    refresh();
    toast(`Restored project “${p.name}”.`);
  };

  const deleteP = async (p: Project) => {
    const ok = await confirmDialog({
      title: `Delete project “${p.name}” forever?`,
      body: "Its boards are kept and stay under Unfiled. This can't be undone.",
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    await deleteProject(p.id);
    refresh();
    toast(`Deleted project “${p.name}” forever.`);
  };

  return (
    <section className="trash-view" aria-labelledby="trash-title">
      <h2 id="trash-title" className="sr-only">
        Trash
      </h2>
      <p className="trash-note">
        Boards stay here for 30 days, then are deleted forever. Projects stay until you delete them.
        {syncing ? ' Git Sync keeps trashed boards in your repo until then.' : ''}
      </p>

      {empty && <p className="trash-empty">Trash is empty.</p>}

      {projects.length > 0 && (
        <>
          <h3 className="trash-heading">Projects</h3>
          <ul className="trash-list">
            {projects.map((p) => (
              <li key={p.id} className="trash-row">
                <span className="trash-thumb proj" aria-hidden="true">
                  <Folder size={18} />
                </span>
                <span className="trash-info">
                  <span className="name">{p.name}</span>
                  <span className="date">
                    Trashed <time title={fullTime(p.deletedAt!)}>{relativeTime(p.deletedAt!, now)}</time>
                  </span>
                </span>
                <button className="chrome-btn" onClick={() => void restoreP(p)} aria-label={`Restore project ${p.name}`}>
                  Restore
                </button>
                <button className="chrome-btn danger" onClick={() => void deleteP(p)} aria-label={`Delete project ${p.name} forever`}>
                  Delete forever
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {boards.length > 0 && (
        <>
          <h3 className="trash-heading">Boards</h3>
          <ul className="trash-list">
            {boards.map((b) => {
              const from = projName(b.projectId);
              return (
                <li key={b.id} className="trash-row">
                  {b.thumb ? <img className="trash-thumb" src={b.thumb} alt="" /> : <span className="trash-thumb" aria-hidden="true" />}
                  <span className="trash-info">
                    <span className="name">{b.name}</span>
                    <span className="date">
                      Trashed <time title={fullTime(b.deletedAt!)}>{relativeTime(b.deletedAt!, now)}</time>
                      {from ? ` · from ${from}` : ''}
                    </span>
                  </span>
                  <button className="chrome-btn" onClick={() => void restoreB(b)} aria-label={`Restore ${b.name}`}>
                    Restore
                  </button>
                  <button className="chrome-btn danger" onClick={() => void deleteB(b)} aria-label={`Delete ${b.name} forever`}>
                    Delete forever
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
