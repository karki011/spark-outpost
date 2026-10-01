import { randomUUID } from 'node:crypto';
import {
  modeForLegacy,
  type InvolvementLevel,
  type PieceList,
  type ProviderId,
} from '@spark-outpost/contracts';
import { sendUserMessage } from '../src/persistence/conversations.ts';
import type { OrchestratorDeps } from '../src/orchestration/session.ts';
import { loadOrchestration } from '../src/persistence/orchestrations.ts';
import { currentPieceList } from '../src/persistence/pieces.ts';
import { linkedConversation } from './approval-support.ts';
import {
  NORMAL,
  jevFetch,
  startOrchestrator,
  withTag,
  type Harness,
} from './orchestration-support.ts';
import type { TestDb } from './support.ts';

export interface Child {
  id: string;
  role: string;
  provider: string;
  name: string;
  pieceKey: string | null;
  resumeKey: string | null;
  prompt: string;
  status: string;
  error: string | null;
}

export async function children(t: TestDb, runId: string): Promise<Child[]> {
  const { rows } = await t.db.query<{
    id: string;
    role: string;
    provider: string;
    route: Record<string, string>;
    prompt: string;
    status: string;
    error: string | null;
  }>(
    `SELECT id, role, provider, route, prompt, status, error FROM runs
     WHERE parent_run_id = $1 ORDER BY created_at`,
    [runId],
  );
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    provider: row.provider,
    name: row.route.name ?? '',
    pieceKey: row.route.pieceKey ?? null,
    resumeKey: row.route.resumeKey ?? null,
    prompt: row.prompt,
    status: row.status,
    error: row.error,
  }));
}

export async function pieceList(t: TestDb, runId: string): Promise<PieceList> {
  const view = await loadOrchestration(t.db, runId);
  const list = await currentPieceList(t.db, view!.taskId!);
  return list!;
}

export interface PiecesStart {
  level?: InvolvementLevel;
  provider?: ProviderId;
  agentEnv?: Record<string, string>;
  jev?: typeof fetch;
  codeScan?: OrchestratorDeps['codeScan'];
}

const MODELS: Record<ProviderId, string> = { claude: 'sonnet', codex: 'gpt-6-sol', zai: 'glm' };

export async function startPieces(
  t: TestDb,
  root: string,
  tags: string,
  { level = 'hands-off', provider = 'claude', agentEnv, jev, codeScan }: PiecesStart = {},
): Promise<{ harness: Harness; conversationId: string; runId: string }> {
  const harness = startOrchestrator(t, jev ?? jevFetch({ calls: [], scenario: NORMAL }), {
    coordinator: 'in_order',
    ...(agentEnv ? { agentEnv } : {}),
    ...(codeScan ? { codeScan } : {}),
  });
  const scenario = withTag(NORMAL, `Split this up. ${tags}`);
  const { conversationId } = await linkedConversation(t, root);
  await t.db.query(`UPDATE conversations SET model_routing = 'auto' WHERE id = $1`, [
    conversationId,
  ]);
  const sent = await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: scenario.text },
    {
      provider,
      model: MODELS[provider],
      effort: 'medium',
      permission: 'do',
      agentMode: modeForLegacy(provider, 'do', level),
      level,
    },
  );
  return { harness, conversationId, runId: sent.run.id };
}
