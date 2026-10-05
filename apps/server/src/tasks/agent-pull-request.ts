import { redactValue } from '../audit/redact.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import { primaryChatWorktree } from '../persistence/chat-worktrees.ts';
import type { Db } from '../persistence/db.ts';
import { watchPullRequest } from '../persistence/pr-watches.ts';

const GITHUB_PULL = /^https:\/\/(github\.com)\/([^/]+)\/([^/]+)\/pull\/(\d+)$/;

interface Opener {
  workspace_id: string;
  conversation_id: string;
  provider: string;
  role: string | null;
}

export async function adoptAgentPullRequest(
  db: Db,
  runId: string,
  taskId: string,
  url: string,
): Promise<void> {
  const parsed = GITHUB_PULL.exec(url);
  if (!parsed) return;
  const [, host, owner, repo, number] = parsed as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const { rows } = await db.query<Opener>(
    `SELECT c.workspace_id, c.id AS conversation_id, r.provider, r.role
     FROM runs r JOIN conversations c ON c.id = r.conversation_id WHERE r.id = $1`,
    [runId],
  );
  const opener = rows[0];
  if (!opener) return;
  const worktree = await primaryChatWorktree(db, opener.conversation_id);
  const branch = worktree?.ownsBranch ? worktree.branch : null;
  if (branch) {
    await watchPullRequest(db, {
      workspaceId: opener.workspace_id,
      conversationId: opener.conversation_id,
      taskId,
      host,
      owner,
      repo,
      number: Number(number),
      url,
      branch,
    });
  }
  const payload = redactValue({
    outcome: 'opened',
    by: opener.role ?? opener.provider,
    via: 'agent_command',
    url,
    number: Number(number),
    repo: `${owner}/${repo}`,
    branch,
    base: worktree?.baseBranch ?? null,
    watched: branch !== null,
  });
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'ship',
      method: 'ship/agent_pr',
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}
