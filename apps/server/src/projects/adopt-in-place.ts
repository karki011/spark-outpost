import type { WorktreeSource } from './chat-worktrees.ts';
import { changedFiles } from './chat-worktrees.ts';
import {
  chatHasOpenRun,
  repointChatWorktree,
  type ChatWorktree,
} from '../persistence/chat-worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { git } from './snapshot.ts';

export const IN_CHECKOUT =
  'This chat works in your checkout, not its own worktree. Start a new chat for the pull request.';
export const TURN_OPEN =
  "Wait for this chat's turn to finish, or stop it, then adopt the pull request.";
export const UNCOMMITTED =
  "This chat's worktree has uncommitted changes. Commit or discard them, then adopt the pull request.";

export async function inPlaceRefusal(db: Db, current: ChatWorktree): Promise<string | null> {
  if (current.inPlace) return IN_CHECKOUT;
  if (current.conversationId && (await chatHasOpenRun(db, current.conversationId))) {
    return TURN_OPEN;
  }
  if ((await changedFiles(current.path)).length > 0) return UNCOMMITTED;
  return null;
}

function checkoutArgs(source: WorktreeSource): string[] {
  if (source.kind === 'existing') return ['checkout', '--quiet', source.branch];
  if (source.kind === 'remote') {
    return ['checkout', '--quiet', '--track', '-b', source.branch, source.ref];
  }
  return ['checkout', '--quiet', '-b', source.branch, source.from];
}

export async function switchInPlace(
  db: Db,
  current: ChatWorktree,
  source: WorktreeSource,
  base: string,
): Promise<void> {
  await git(current.path, checkoutArgs(source));
  const commit = (await git(current.path, ['rev-parse', 'HEAD'])).trim();
  await repointChatWorktree(db, current.id, { name: source.branch, base, commit });
}
