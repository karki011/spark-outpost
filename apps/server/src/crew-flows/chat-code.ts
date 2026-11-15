import { createHash } from 'node:crypto';
import { primaryChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { currentBranch } from '../projects/chat-worktrees.ts';
import { git, headCommit, isGitWorkTree } from '../projects/snapshot.ts';

export interface ChatCode {
  root: string;
  base: string | null;
}

export async function chatCode(db: Queryable, conversationId: string): Promise<ChatCode | null> {
  const worktree = await primaryChatWorktree(db, conversationId);
  if (worktree) return { root: worktree.path, base: worktree.baseCommit || null };
  const { rows } = await db.query<{ root_path: string }>(
    `SELECT p.root_path FROM conversation_projects cp JOIN projects p ON p.id = cp.project_id
     WHERE cp.conversation_id = $1 ORDER BY cp.position, cp.created_at LIMIT 1`,
    [conversationId],
  );
  return rows[0] ? { root: rows[0].root_path, base: null } : null;
}

async function untrackedHashes(root: string): Promise<string> {
  const listed = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const files = listed.split('\0').filter(Boolean).sort();
  if (files.length === 0) return '';
  const hashes = await git(root, ['hash-object', '--', ...files]).catch(() => '');
  return files.map((file, index) => `${file} ${hashes.split('\n')[index] ?? ''}`).join('\n');
}

export async function diffHash(code: ChatCode): Promise<string | null> {
  if (!(await isGitWorkTree(code.root).catch(() => false))) return null;
  try {
    const base = code.base ?? (await headCommit(code.root)) ?? 'HEAD';
    const [diff, untracked] = await Promise.all([
      git(code.root, ['diff', '--no-ext-diff', '--binary', base, '--']),
      untrackedHashes(code.root),
    ]);
    return createHash('sha256').update(diff).update('\0').update(untracked).digest('hex');
  } catch {
    return null;
  }
}

export interface BranchTip {
  branch: string | null;
  tip: string;
}

export async function branchTip(root: string): Promise<BranchTip | null> {
  const tip = await headCommit(root);
  return tip ? { branch: await currentBranch(root), tip } : null;
}
