import { randomUUID } from 'node:crypto';
import type { AgentRole, OutcomeVerdict } from '@spark-outpost/contracts';
import type { Queryable } from '../src/persistence/db.ts';

export interface SeedMember {
  role: AgentRole;
  provider: string;
  model: string;
  modelLabel?: string;
  name?: string;
  costUsd?: number;
  costSource?: 'reported' | 'estimated';
  input?: number;
  output?: number;
  cachedRead?: number;
  routedByJev?: boolean;
  session?: 'continued' | 'fresh';
}

export interface SeedIntake {
  rules: Record<string, unknown>;
  jev: Record<string, unknown> | null;
  wouldApply: 'jev' | 'ask' | 'rules';
  decision?: 'act' | 'ask' | 'fallback';
  actAt?: number;
  jevCostUsd?: number;
}

export interface AnalyticsTurn {
  conversationId: string;
  createdAt: Date;
  provider?: string;
  model?: string | undefined;
  category?: string;
  depth?: string;
  retries?: number;
  costUsd?: number | undefined;
  crew?: SeedMember[];
  verdict?: OutcomeVerdict;
  score?: number;
  signals?: ('kept' | 'reverted' | 'correction' | 'committed' | 'checks_passed')[];
  intake?: SeedIntake;
  buildStyle?: 'off' | 'lite' | 'lean' | undefined;
  reviews?: { verdict: string; findings: number; net?: number }[];
  checks?: { round: number; status: 'passed' | 'failed' }[];
  approvals?: { kind: string; waitMs: number }[];
}

export async function seedProjectChat(
  db: Queryable,
  workspaceId: string,
  projectName: string | null,
): Promise<string> {
  const conversationId = randomUUID();
  await db.query('INSERT INTO conversations (id, workspace_id, title) VALUES ($1, $2, $3)', [
    conversationId,
    workspaceId,
    projectName ?? 'Loose chat',
  ]);
  if (!projectName) return conversationId;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO projects (id, workspace_id, name, root_path) VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, root_path) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [randomUUID(), workspaceId, projectName, `/tmp/analytics/${projectName}`],
  );
  await db.query(
    'INSERT INTO conversation_projects (conversation_id, project_id, position) VALUES ($1, $2, 0)',
    [conversationId, rows[0]!.id],
  );
  return conversationId;
}

async function insertRun(
  db: Queryable,
  turn: AnalyticsTurn,
  messageId: string,
  parentId: string | null,
  member: SeedMember | null,
  offsetMs: number,
): Promise<string> {
  const id = randomUUID();
  const at = new Date(turn.createdAt.getTime() + offsetMs);
  const cost = member ? (member.costUsd ?? null) : (turn.costUsd ?? null);
  const input = member?.input ?? null;
  const output = member?.output ?? null;
  const route = member
    ? {
        name: member.name ?? null,
        modelLabel: member.modelLabel ?? null,
        routedBy: member.routedByJev ? 'jev' : 'rules',
      }
    : null;
  await db.query(
    `INSERT INTO runs (id, conversation_id, user_message_id, provider, status, created_at,
       started_at, finished_at, category, mode, parent_run_id, role, model, cost_usd, cost_source,
       input_tokens, output_tokens, cached_read_tokens, total_tokens, route)
     VALUES ($1, $2, $3, $4, 'succeeded', $5, $5, $5::timestamptz + interval '40 seconds', $6, 'do',
       $7, $8, $9, $10, $11, $12, $13, $14, $12::int + $13::int, $15)`,
    [
      id,
      turn.conversationId,
      messageId,
      member?.provider ?? turn.provider ?? 'claude',
      at,
      turn.category ?? null,
      parentId,
      member?.role ?? null,
      member?.model ?? turn.model ?? null,
      cost,
      cost === null ? null : (member?.costSource ?? 'reported'),
      input,
      output,
      member?.cachedRead ?? null,
      route ? JSON.stringify(route) : null,
    ],
  );
  if (member?.session) {
    const step = member.session === 'continued' ? 'Continued session' : 'Fresh session (idle)';
    await db.query(
      `INSERT INTO run_events (run_id, seq, type, payload) VALUES ($1, 1, 'STEP_STARTED', $2)`,
      [id, JSON.stringify({ type: 'STEP_STARTED', stepName: step })],
    );
  }
  return id;
}

async function seedOutcome(
  db: Queryable,
  runId: string,
  turn: AnalyticsTurn,
  taskId: string | null,
) {
  if (!turn.verdict) return;
  await db.query(
    `INSERT INTO task_outcomes (run_id, task_id, kind, score, verdict, settled_at)
     VALUES ($1, $2, 'change', $3, $4, now())`,
    [runId, taskId, turn.score ?? null, turn.verdict],
  );
  const negative = new Set(['reverted', 'correction']);
  for (const kind of turn.signals ?? []) {
    await db.query(
      `INSERT INTO outcome_signals (run_id, kind, polarity, source, at) VALUES ($1, $2, $3, $4, $5)`,
      [
        runId,
        kind,
        negative.has(kind) ? -1 : 1,
        kind === 'kept' ? 'user' : 'harness',
        turn.createdAt,
      ],
    );
  }
}

async function seedAdvice(db: Queryable, runId: string, turn: AnalyticsTurn) {
  const intake = turn.intake;
  if (intake) {
    const differences = intake.jev
      ? ['provider', 'model', 'effort', 'depth', 'risk'].filter(
          (field) => intake.jev![field] !== undefined && intake.jev![field] !== intake.rules[field],
        )
      : [];
    const gate = intake.decision
      ? {
          decision: intake.decision,
          confidence: intake.jev?.confidence,
          actAt: intake.actAt ?? 0.9,
        }
      : null;
    await db.query(
      `INSERT INTO run_advice (run_id, purpose, jev_status, jev_cost_usd, body)
       VALUES ($1, 'intake', $2, $3, $4)`,
      [
        runId,
        intake.jev ? 'answered' : 'not_connected',
        intake.jevCostUsd ?? null,
        JSON.stringify({
          rules: intake.rules,
          jev: intake.jev,
          gate,
          wouldApply: intake.wouldApply,
          differences,
        }),
      ],
    );
  }
  if (turn.buildStyle) {
    await db.query(
      `INSERT INTO run_advice (run_id, purpose, jev_status, body)
       VALUES ($1, 'build_style', 'not_asked', $2)`,
      [runId, JSON.stringify({ answer: { chosen: turn.buildStyle } })],
    );
  }
}

async function seedArtifacts(
  db: Queryable,
  taskId: string,
  sourceRunId: string,
  turn: AnalyticsTurn,
) {
  let version = 0;
  for (const check of turn.checks ?? []) {
    version += 1;
    const body = { runId: sourceRunId, name: 'Bolt', copy: null, results: [], ...check };
    await db.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
       VALUES ($1, 'check', $2, $3, $4)`,
      [taskId, version, JSON.stringify(body), sourceRunId],
    );
  }
  let reviewVersion = 0;
  for (const review of turn.reviews ?? []) {
    reviewVersion += 1;
    const findings = Array.from({ length: review.findings }, (_, index) => `Finding ${index + 1}`);
    const body = { verdict: review.verdict, findings, net: review.net ?? null, text: '' };
    await db.query(
      `INSERT INTO run_artifacts (task_id, kind, version, body, source_run_id)
       VALUES ($1, 'review', $2, $3, $4)`,
      [taskId, reviewVersion, JSON.stringify(body), sourceRunId],
    );
  }
}

async function seedApprovals(db: Queryable, runId: string, turn: AnalyticsTurn) {
  for (const approval of turn.approvals ?? []) {
    const created = new Date(turn.createdAt.getTime() + 5_000);
    await db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash, options,
         status, scope, decided_by, decided_at, created_at)
       VALUES ($1, $2, $3, $4, 'Seeded approval', '{}', 'hash', '[]', 'allowed', 'once', 'user',
         $5, $6)`,
      [
        randomUUID(),
        runId,
        randomUUID(),
        approval.kind,
        new Date(created.getTime() + approval.waitMs),
        created,
      ],
    );
  }
}

export async function seedAnalyticsTurn(db: Queryable, turn: AnalyticsTurn): Promise<string> {
  const messageId = randomUUID();
  await db.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, 'user', 'Seeded request', $3)`,
    [messageId, turn.conversationId, turn.createdAt],
  );
  const runId = await insertRun(db, turn, messageId, null, null, 0);
  await db.query(
    `INSERT INTO orchestrations (run_id, phase, depth, depth_source, risk, routing, retries,
       active_limit_ms, tool_call_limit)
     VALUES ($1, 'finished', $2, 'rules', 'edits', 'auto', $3, 900000, 60)`,
    [runId, turn.depth ?? 'execute', turn.retries ?? 0],
  );
  let offset = 1000;
  for (const member of turn.crew ?? []) {
    await insertRun(db, turn, messageId, runId, member, offset);
    offset += 1000;
  }
  const needsTask = (turn.checks?.length ?? 0) > 0 || (turn.reviews?.length ?? 0) > 0;
  const taskId = needsTask ? randomUUID() : null;
  if (taskId) {
    await db.query('INSERT INTO tasks (id, conversation_id, title) VALUES ($1, $2, $3)', [
      taskId,
      turn.conversationId,
      'Seeded task',
    ]);
    await db.query('UPDATE runs SET task_id = $2 WHERE id = $1', [runId, taskId]);
    await seedArtifacts(db, taskId, runId, turn);
  }
  await seedOutcome(db, runId, turn, taskId);
  await seedAdvice(db, runId, turn);
  await seedApprovals(db, runId, turn);
  return runId;
}
