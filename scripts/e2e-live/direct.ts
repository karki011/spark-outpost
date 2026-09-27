import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { decideApproval } from '../../apps/server/src/persistence/approvals.ts';
import {
  getConversationDetail,
  sendUserMessage,
} from '../../apps/server/src/persistence/conversations.ts';
import { claimNextJob } from '../../apps/server/src/persistence/jobs.ts';
import { requestCancel } from '../../apps/server/src/persistence/runs.ts';
import { estimateCostUsd } from '../../apps/server/src/usage/prices.ts';
import { executeChildRun } from '../../apps/server/src/workflow/execute-run.ts';
import { orchestrate } from '../../apps/server/src/orchestration/orchestrator.ts';
import type { BuildStyle } from '../../packages/contracts/src/index.ts';
import { linkedConversation } from '../../apps/server/test/approval-support.ts';
import { BENCH_LEVEL, PINNED, benchAnswer, type BenchEnv } from '../bench/live.ts';
import type { AgentUsage } from '../bench/results.ts';
import { collectTurn, type TurnMetrics } from './collect.ts';

export const CODEX_MODEL = 'gpt-6-sol';
export type CodexEffort = 'low' | 'medium' | 'high';
const ROOT = resolve(import.meta.dirname, '../..');

export interface DirectTurn {
  metrics: TurnMetrics;
  autoDenied: number;
}

export interface InProcessOptions {
  harness: boolean;
  buildStyle: BuildStyle;
}

export interface InProcessSession {
  send(text: string): Promise<DirectTurn>;
}

async function recordReply(env: BenchEnv, runId: string): Promise<void> {
  const { rows } = await env.t.db.query<{ id: string | null; text: string | null }>(
    `SELECT e.payload->>'messageId' AS id,
       (SELECT string_agg(c.payload->>'delta', '' ORDER BY c.seq) FROM run_events c
        WHERE c.run_id = $1 AND c.type = 'TEXT_MESSAGE_CONTENT'
          AND c.payload->>'messageId' = e.payload->>'messageId') AS text
     FROM run_events e WHERE e.run_id = $1 AND e.type = 'TEXT_MESSAGE_END'
     ORDER BY e.seq DESC LIMIT 1`,
    [runId],
  );
  const reply = rows[0];
  if (!reply?.id || !reply.text) return;
  await env.t.db.query(
    `INSERT INTO messages (id, conversation_id, role, content, run_id)
     SELECT $1, conversation_id, 'assistant', $2, id FROM runs WHERE id = $3
     ON CONFLICT (id) DO NOTHING`,
    [reply.id, reply.text, runId],
  );
}

export async function inProcessSession(
  env: BenchEnv,
  repo: string,
  timeoutMs: number,
  options: InProcessOptions = { harness: false, buildStyle: 'off' },
): Promise<InProcessSession> {
  const { t } = env;
  const { conversationId } = await linkedConversation(t, repo);
  const routing = options.harness ? 'auto' : 'pinned';
  await t.db.query('UPDATE conversations SET model_routing = $2 WHERE id = $1', [
    conversationId,
    routing,
  ]);
  await t.db.query('UPDATE projects SET build_style = $2 WHERE root_path = $1', [
    repo,
    options.buildStyle,
  ]);
  const send = async (text: string): Promise<DirectTurn> => {
    const sent = await sendUserMessage(
      t.db,
      conversationId,
      { id: randomUUID(), content: text },
      { ...PINNED, permission: 'do', level: BENCH_LEVEL },
    );
    const lease = await claimNextJob(t.db, env.deps.leaseSeconds);
    if (lease?.runId !== sent.run.id) throw new Error('The direct arm could not claim its run.');
    const started = Date.now();
    let settled = false;
    const running = options.harness
      ? orchestrate(env.deps, lease)
      : executeChildRun(env.deps, lease).then(() => undefined);
    const work = running.finally(() => {
      settled = true;
    });
    let autoDenied = 0;
    let cancelled = false;
    while (!settled) {
      const detail = await getConversationDetail(t.db, conversationId);
      for (const approval of detail?.approvals ?? []) {
        if (approval.status !== 'pending') continue;
        const choice = benchAnswer(approval);
        if (choice.autoDenied) autoDenied += 1;
        await decideApproval(t.db, t.workspaceId, approval.id, {
          scope: 'once',
          optionId: choice.optionId,
        });
      }
      if (!cancelled && Date.now() - started > timeoutMs) {
        cancelled = true;
        await requestCancel(t.db, sent.run.id);
      }
      await new Promise((done) => setTimeout(done, 250));
    }
    await work;
    const metrics = await collectTurn(t.db, sent.run.id, Date.now() - started);
    if (!options.harness) await recordReply(env, sent.run.id);
    return { metrics, autoDenied };
  };
  return { send };
}

export async function directClaudeTurns(
  env: BenchEnv,
  repo: string,
  turns: readonly string[],
  timeoutMs: number,
  options: InProcessOptions = { harness: false, buildStyle: 'off' },
): Promise<DirectTurn[]> {
  const session = await inProcessSession(env, repo, timeoutMs, options);
  const results: DirectTurn[] = [];
  for (const text of turns) results.push(await session.send(text));
  return results;
}

interface CodexEvent {
  type?: string;
  thread_id?: string;
  item?: { type?: string; text?: string; command?: string };
  usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number };
  model?: string;
  message?: string;
}

interface CodexRun {
  threadId: string | null;
  reply: string;
  input: number;
  cached: number;
  output: number;
  toolCalls: number;
  error: string | null;
  exitCode: number | null;
}

function codexBinary(): string {
  if (process.env.E2E_FAKE_CODEX === '1') return join(ROOT, 'tests/browser/bin/codex');
  return 'codex';
}

function codexArgs(prompt: string, threadId: string | null, effort: CodexEffort): string[] {
  const config = [
    '-c',
    'sandbox_mode="workspace-write"',
    '-c',
    'approval_policy="never"',
    '-c',
    `model_reasoning_effort="${effort}"`,
    '-m',
    CODEX_MODEL,
    '--json',
    '--skip-git-repo-check',
  ];
  if (threadId) return ['exec', 'resume', ...config, threadId, prompt];
  return ['exec', ...config, prompt];
}

function runCodex(
  repo: string,
  prompt: string,
  threadId: string | null,
  timeoutMs: number,
  effort: CodexEffort,
) {
  return new Promise<CodexRun>((done) => {
    const child = spawn(codexBinary(), codexArgs(prompt, threadId, effort), {
      cwd: repo,
      env: { ...process.env, FAKE_CODEX_STATE: process.env.FAKE_CODEX_STATE ?? '/dev/null' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result: CodexRun = {
      threadId,
      reply: '',
      input: 0,
      cached: 0,
      output: 0,
      toolCalls: 0,
      error: null,
      exitCode: null,
    };
    let buffer = '';
    const timer = setTimeout(() => {
      result.error = 'Timed out and was stopped.';
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) readEvent(line, result);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      readEvent(buffer, result);
      result.exitCode = code;
      if (code !== 0 && !result.error) result.error = `codex exited ${code}`;
      done(result);
    });
  });
}

function readEvent(line: string, result: CodexRun): void {
  if (!line.trim().startsWith('{')) return;
  let event: CodexEvent;
  try {
    event = JSON.parse(line) as CodexEvent;
  } catch {
    return;
  }
  if (event.type === 'thread.started' && event.thread_id) result.threadId = event.thread_id;
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    result.reply = event.item.text ?? result.reply;
  }
  if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
    result.toolCalls += 1;
  }
  if (event.type === 'item.completed' && event.item?.type === 'file_change') result.toolCalls += 1;
  if (event.type === 'turn.completed' && event.usage) {
    result.input += event.usage.input_tokens ?? 0;
    result.cached += event.usage.cached_input_tokens ?? 0;
    result.output += event.usage.output_tokens ?? 0;
  }
  if (event.type === 'error' || event.type === 'turn.failed') {
    result.error = event.message ?? 'codex reported an error';
  }
}

function codexMetrics(run: CodexRun, wallMs: number, effort: CodexEffort): TurnMetrics {
  const costUsd =
    estimateCostUsd('codex', CODEX_MODEL, {
      input: run.input,
      output: run.output,
      cachedRead: run.cached,
    }) ?? 0;
  const agent: AgentUsage = {
    role: 'agent',
    name: null,
    provider: 'codex',
    model: CODEX_MODEL,
    effort,
    status: run.error ? 'failed' : 'succeeded',
    inputTokens: run.input,
    outputTokens: run.output,
    cachedReadTokens: run.cached,
    cachedWriteTokens: 0,
    costUsd,
    costSource: 'estimated',
    durationMs: wallMs,
    toolCalls: run.toolCalls,
    parallelGroup: null,
  };
  return {
    runId: run.threadId ?? 'codex',
    status: agent.status,
    error: run.error,
    wallMs,
    waitedMs: 0,
    activeMs: wallMs,
    costUsd,
    agentCostUsd: costUsd,
    jevCostUsd: 0,
    jevCalls: 0,
    agents: [agent],
    toolCalls: run.toolCalls,
    routing: null,
    approvals: [],
    checks: [],
    fixTurns: 0,
    sessionNotes: [],
    reviews: [],
    lanes: {
      worktrees: 0,
      depsMethods: [],
      depsMs: [],
      depsWaitedMs: [],
      depsNotes: [],
      builderMs: [],
      parallelBuilders: 0,
    },
    shortcuts: 0,
    reply: run.reply,
  };
}

export async function directCodexTurns(
  repo: string,
  turns: readonly string[],
  timeoutMs: number,
  effort: CodexEffort,
): Promise<DirectTurn[]> {
  const results: DirectTurn[] = [];
  let threadId: string | null = null;
  for (const text of turns) {
    const started = Date.now();
    const run = await runCodex(repo, text, threadId, timeoutMs, effort);
    threadId = run.threadId;
    results.push({ metrics: codexMetrics(run, Date.now() - started, effort), autoDenied: 0 });
  }
  return results;
}
