import type { PrOpenedVia } from '@spark-outpost/contracts';
import { redactValue } from '../audit/redact.ts';
import { insertFinishedRunEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import { trackPull, type PullAddress, type Tracked } from '../persistence/tracked-pulls.ts';
import { parsePullUrl } from '../tickets/pull-status.ts';
import { chatRepoOf, chatRepos, ownedBranch } from './chat-repos.ts';

export interface PullSighting {
  conversationId: string;
  url: string;
  via: PrOpenedVia;
  by: string | null;
  runId: string | null;
  taskId: string | null;
  head?: string | null;
  base?: string | null;
  title?: string | null;
  draft?: boolean;
}

interface Chat {
  workspace_id: string;
  task_id: string | null;
  run_id: string | null;
}

async function chatOf(db: Db, conversationId: string): Promise<Chat | null> {
  const { rows } = await db.query<Chat>(
    `SELECT c.workspace_id,
       (SELECT t.id FROM tasks t WHERE t.conversation_id = c.id
        ORDER BY t.created_at DESC LIMIT 1) AS task_id,
       (SELECT r.id FROM runs r WHERE r.conversation_id = c.id
        ORDER BY r.created_at DESC LIMIT 1) AS run_id
     FROM conversations c WHERE c.id = $1`,
    [conversationId],
  );
  return rows[0] ?? null;
}

export function pullAddress(url: string): PullAddress | null {
  const parsed = parsePullUrl(url);
  if (!parsed) return null;
  return { host: parsed.host, owner: parsed.owner, repo: parsed.name, number: parsed.number };
}

export const pullUrl = (address: PullAddress) =>
  `https://${address.host}/${address.owner}/${address.repo}/pull/${address.number}`;

const AUDIT_METHOD: Record<PrOpenedVia, string> = {
  ship: 'ship/pr_tracked',
  agent: 'ship/agent_pr',
  terminal: 'ship/pr_tracked',
  discovery: 'ship/pr_tracked',
};

const AUDIT_VIA: Record<PrOpenedVia, string> = {
  ship: 'ship',
  agent: 'agent_command',
  terminal: 'terminal',
  discovery: 'discovery',
};

async function audit(db: Db, runId: string, sighting: PullSighting, tracked: Tracked) {
  const { pull } = tracked;
  const payload = redactValue({
    outcome: sighting.via === 'discovery' ? 'found' : 'opened',
    by: sighting.by,
    via: AUDIT_VIA[sighting.via],
    url: pull.url,
    number: pull.number,
    repo: `${pull.owner}/${pull.repo}`,
    branch: pull.branch || null,
    base: pull.base,
    outside: pull.outside,
    watched: pull.followUp,
    at: pull.openedAt.toISOString(),
  });
  await insertFinishedRunEntries(db, runId, [
    {
      at: new Date(),
      direction: 'harness',
      kind: 'ship',
      method: AUDIT_METHOD[sighting.via],
      rpcId: null,
      sizeBytes: Buffer.byteLength(JSON.stringify(payload)),
      truncated: false,
      payload,
    },
  ]);
}

export async function trackChatPull(db: Db, sighting: PullSighting): Promise<Tracked | null> {
  const address = pullAddress(sighting.url);
  const chat = address ? await chatOf(db, sighting.conversationId) : null;
  if (!address || !chat) return null;
  const repos = await chatRepos(db, sighting.conversationId);
  const taskId = sighting.taskId ?? chat.task_id;
  const owned = ownedBranch(repos, address, sighting.head ?? null);
  const tracked = await trackPull(db, {
    ...address,
    workspaceId: chat.workspace_id,
    conversationId: sighting.conversationId,
    taskId,
    url: pullUrl(address),
    branch: sighting.head ?? owned ?? '',
    draft: sighting.draft,
    via: sighting.via,
    by: sighting.by,
    runId: sighting.runId,
    outside: repos.length > 0 && chatRepoOf(repos, address) === null,
    followUp: owned !== null && taskId !== null,
    title: sighting.title,
    base: sighting.base,
  });
  const auditRun = sighting.runId ?? chat.run_id;
  if (tracked?.created && auditRun) await audit(db, auditRun, sighting, tracked);
  return tracked;
}
