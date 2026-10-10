import type { AgentTerminalRow } from '../persistence/agent-terminals.ts';
import { chatWorktreesOf } from '../persistence/chat-worktrees.ts';
import { conversationRoots } from '../persistence/conversation-projects.ts';
import type { Queryable } from '../persistence/db.ts';

export async function agentTerminalSecretRoots(
  db: Queryable,
  row: Pick<AgentTerminalRow, 'conversationId' | 'cwd'>,
): Promise<string[]> {
  const [roots, worktrees] = await Promise.all([
    conversationRoots(db, row.conversationId),
    chatWorktreesOf(db, row.conversationId),
  ]);
  return [...new Set([...roots, ...worktrees.map((worktree) => worktree.path), row.cwd])];
}
