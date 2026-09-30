import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditExportLineSchema,
  auditLogPageSchema,
  auditSummarySchema,
  chainVerificationSchema,
} from '@spark-outpost/contracts';
import { createProtocolRecorder } from '../src/audit/protocol-entry.ts';
import { insertProtocolEntries } from '../src/persistence/audit-log.ts';
import { createConversation, sendUserMessage } from '../src/persistence/conversations.ts';
import { claimNextJob } from '../src/persistence/jobs.ts';
import {
  recordRunMetrics,
  recordSessionSettings,
  recordTokens,
  recordUsage,
} from '../src/workflow/run-metadata.ts';
import { estimateCostUsd } from '../src/usage/prices.ts';
import { createTestApp, LOCAL_HEADERS } from './app-support.ts';
import { createTestDb, type TestDb } from './support.ts';

let t: TestDb;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  t = await createTestDb();
  app = createTestApp(t);
});

afterEach(async () => {
  await t.cleanup();
});

const get = (path: string) => request(app).get(path).set(LOCAL_HEADERS);

interface RunSpec {
  provider: string;
  model: string;
  cost: number | null;
  input: number;
  output: number;
  cached: number;
  thought: number | null;
  messages: number;
}

async function finishedRun(conversationId: string, spec: RunSpec): Promise<string> {
  await sendUserMessage(
    t.db,
    conversationId,
    { id: randomUUID(), content: 'go' },
    { provider: spec.provider, model: 'requested' },
  );
  const lease = (await claimNextJob(t.db, 30))!;
  const recorder = createProtocolRecorder();
  const entries = Array.from({ length: spec.messages }, (_, index) =>
    recorder.entry('to_agent', { jsonrpc: '2.0', id: index, method: 'session/prompt' }),
  );
  await insertProtocolEntries(t.db, lease, entries);
  await recordSessionSettings(t.db, lease.runId, {
    kind: 'session_settings',
    model: spec.model,
    effort: 'high',
    mode: 'read-only',
  });
  await recordUsage(t.db, lease.runId, {
    kind: 'usage',
    contextUsed: 10,
    contextSize: 100,
    costUsd: spec.cost,
  });
  await recordTokens(t.db, lease.runId, {
    kind: 'tokens',
    tokens: {
      input: spec.input,
      output: spec.output,
      total: spec.input + spec.output,
      cachedRead: spec.cached,
      cachedWrite: null,
      thought: spec.thought,
    },
  });
  await recordRunMetrics(t.db, lease.runId, { durationMs: 1500, toolCallCount: 2 });
  return lease.runId;
}

const claude: RunSpec = {
  provider: 'claude',
  model: 'sonnet',
  cost: 0.02,
  input: 100,
  output: 50,
  cached: 30,
  thought: null,
  messages: 3,
};
const codex: RunSpec = {
  provider: 'codex',
  model: 'gpt-6-sol',
  cost: null,
  input: 10_000,
  output: 2_000,
  cached: 4_000,
  thought: 500,
  messages: 2,
};

describe('audit API', () => {
  it('summarises a chat by provider, model, and run, labelling estimated cost', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const claudeRun = await finishedRun(conversation.id, claude);
    const codexRun = await finishedRun(conversation.id, codex);
    await finishedRun(conversation.id, { ...claude, cost: 0.01, model: 'haiku' });

    const response = await get(`/api/conversations/${conversation.id}/audit/summary`);
    expect(response.status).toBe(200);
    const summary = auditSummarySchema.parse(response.body);
    const estimate = estimateCostUsd('codex', 'gpt-6-sol', {
      input: 10_000,
      output: 2_000,
      cachedRead: 4_000,
    })!;
    expect(summary.runs.map((run) => [run.runId, run.costSource])).toEqual([
      [claudeRun, 'reported'],
      [codexRun, 'estimated'],
      [expect.any(String), 'reported'],
    ]);
    expect(summary.runs[1]).toMatchObject({
      model: 'gpt-6-sol',
      effort: 'high',
      mode: 'read-only',
      durationMs: 1500,
      toolCallCount: 2,
      thoughtTokens: 500,
      costUsd: estimate,
      logEntries: 2,
      logPruned: false,
    });
    expect(summary.totals).toMatchObject({
      runs: 3,
      inputTokens: 10_200,
      outputTokens: 2_100,
      cachedReadTokens: 4_060,
      thoughtTokens: 500,
      toolCalls: 6,
      durationMs: 4500,
      costSource: 'mixed',
    });
    expect(summary.totals.costUsd).toBeCloseTo(0.03 + estimate, 6);
    expect(
      summary.byProvider.map((entry) => [entry.provider, entry.runs, entry.costSource]),
    ).toEqual([
      ['claude', 2, 'reported'],
      ['codex', 1, 'estimated'],
    ]);
    expect(summary.byModel.map((entry) => [entry.provider, entry.model, entry.runs])).toEqual([
      ['claude', 'sonnet', 1],
      ['codex', 'gpt-6-sol', 1],
      ['claude', 'haiku', 1],
    ]);
  });

  it('pages the run log and verifies its chain', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const runId = await finishedRun(conversation.id, { ...claude, messages: 5 });

    const first = await get(`/api/runs/${runId}/audit/log?limit=2`);
    expect(first.status).toBe(200);
    const page = auditLogPageSchema.parse(first.body);
    expect(page.entries.map((entry) => entry.seq)).toEqual([1, 2]);
    const next = await get(`/api/runs/${runId}/audit/log?after=${page.nextAfter}&limit=10`);
    expect(auditLogPageSchema.parse(next.body)).toMatchObject({ nextAfter: null });
    expect(next.body.entries).toHaveLength(3);
    const filtered = await get(`/api/runs/${runId}/audit/log?direction=from_agent`);
    expect(filtered.body.entries).toEqual([]);

    const verify = await get(`/api/runs/${runId}/audit/verify`);
    expect(chainVerificationSchema.parse(verify.body)).toMatchObject({ intact: true, checked: 5 });
  });

  it('rejects bad queries and unknown ids', async () => {
    const missing = randomUUID();
    expect((await get(`/api/runs/${missing}/audit/log`)).status).toBe(404);
    expect((await get(`/api/runs/${missing}/audit/verify`)).status).toBe(404);
    expect((await get(`/api/conversations/${missing}/audit/summary`)).status).toBe(404);
    expect((await get(`/api/conversations/${missing}/audit/export.jsonl`)).status).toBe(404);
    expect((await get(`/api/runs/not-a-uuid/audit/log`)).status).toBe(400);
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const runId = await finishedRun(conversation.id, claude);
    const badLimit = await get(`/api/runs/${runId}/audit/log?limit=5000`);
    expect(badLimit.status).toBe(400);
    expect((await get(`/api/runs/${runId}/audit/log?direction=sideways`)).status).toBe(400);
  });

  it('exports the chat as JSON lines, each run followed by its log', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const claudeRun = await finishedRun(conversation.id, claude);
    const codexRun = await finishedRun(conversation.id, codex);

    const response = await get(`/api/conversations/${conversation.id}/audit/export.jsonl`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/x-ndjson');
    expect(response.headers['content-disposition']).toContain('attachment');
    const lines = response.text
      .trim()
      .split('\n')
      .map((line) => auditExportLineSchema.parse(JSON.parse(line)));
    expect(
      lines.map((line) => (line.type === 'run' ? `run ${line.runId}` : `log ${line.seq}`)),
    ).toEqual([`run ${claudeRun}`, 'log 1', 'log 2', 'log 3', `run ${codexRun}`, 'log 1', 'log 2']);
  });

  it('exports a cost breakdown as CSV with the cost source per run', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const claudeRun = await finishedRun(conversation.id, claude);
    const codexRun = await finishedRun(conversation.id, codex);
    const unpriced = await finishedRun(conversation.id, { ...codex, model: 'gpt-reserve' });

    const response = await get(`/api/conversations/${conversation.id}/audit/export.csv`);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(
      `conversation-${conversation.id}-cost.csv`,
    );
    const [header, ...rows] = response.text.trimEnd().split('\r\n');
    const columns = header!.split(',');
    const cell = (row: string, name: string) => row.split(',')[columns.indexOf(name)];
    expect(columns).toContain('cost_source');
    expect(rows.map((row) => cell(row, 'run_id'))).toEqual([claudeRun, codexRun, unpriced]);
    expect(rows.map((row) => cell(row, 'cost_source'))).toEqual([
      'reported',
      'estimated',
      'not_reported',
    ]);
    expect(rows.map((row) => cell(row, 'role'))).toEqual(['Reader', 'Reader', 'Reader']);
    expect(cell(rows[0]!, 'cost_usd')).toBe('0.02');
    expect(cell(rows[2]!, 'cost_usd')).toBe('');
    expect(cell(rows[1]!, 'thinking_tokens')).toBe('500');

    const missing = await get(`/api/conversations/${randomUUID()}/audit/export.csv`);
    expect(missing.status).toBe(404);
  });

  it('reports run timing, logged methods, and approval waits for the timeline', async () => {
    const conversation = await createConversation(t.db, t.workspaceId, randomUUID());
    const runId = await finishedRun(conversation.id, claude);
    await t.db.query(
      `UPDATE runs SET mode = 'do', started_at = now() - interval '9 seconds',
         finished_at = now() WHERE id = $1`,
      [runId],
    );
    await t.db.query(
      `INSERT INTO approvals (id, run_id, tool_call_id, kind, title, payload, payload_hash,
         options, status, decided_by, decided_at, created_at)
       VALUES
         ($1, $3, 'call-1', 'execute', 'pnpm test', '{}', 'h1', '[]', 'allowed', 'user',
          now() - interval '2 seconds', now() - interval '6 seconds'),
         ($2, $3, 'call-2', 'edit', 'Edit a.ts', '{}', 'h2', '[]', 'allowed', 'level',
          now() - interval '1 second', now() - interval '1 second')`,
      [randomUUID(), randomUUID(), runId],
    );

    const response = await get(`/api/conversations/${conversation.id}/audit/summary`);
    const run = auditSummarySchema.parse(response.body).runs[0]!;
    expect(run).toMatchObject({ role: 'Builder', runMode: 'do', methods: ['session/prompt'] });
    expect(run.startedAt).not.toBeNull();
    expect(run.finishedAt).not.toBeNull();
    expect(run.approvalWaits).toHaveLength(1);
    const wait = run.approvalWaits[0]!;
    expect(Date.parse(wait.end!) - Date.parse(wait.start)).toBeCloseTo(4000, -3);
  });
});
