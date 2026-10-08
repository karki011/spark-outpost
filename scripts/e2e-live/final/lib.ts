import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Approval } from '../../../packages/contracts/src/index.ts';
import { createDb, type Db } from '../../../apps/server/src/persistence/db.ts';
import { Api, sleep } from '../api-driver.ts';

export { sleep };

export const DIR = process.env.FINAL_DIR ?? '';

interface StackState {
  api: string;
  web: string;
  token: string;
  databaseUrl: string;
  workspaceId: string;
  workerPid: number;
}

export interface Ctx {
  api: Api;
  db: Db;
  state: StackState;
}

export interface Chat {
  label: string;
  conversationId: string;
  projectId: string;
  repo: string;
  provider: string;
  mode: string;
}

export const ARMS: Record<string, { provider: string; mode: string }> = {
  'claude-auto': { provider: 'claude', mode: 'auto' },
  'claude-bypass': { provider: 'claude', mode: 'bypassPermissions' },
  'claude-plan': { provider: 'claude', mode: 'plan' },
  'codex-full': { provider: 'codex', mode: 'agent-full-access' },
  'codex-ask': { provider: 'codex', mode: 'ask-every-action' },
};

export function connect(): Ctx {
  const state = JSON.parse(readFileSync(join(DIR, 'stack.json'), 'utf8')) as StackState;
  return { api: new Api(state.api, state.token), db: createDb(state.databaseUrl), state };
}

function git(repo: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-C', repo, '-c', 'user.email=e2e@spark.local', '-c', 'user.name=e2e', ...args],
    { encoding: 'utf8' },
  );
}

export function makeRepo(label: string, files: Record<string, string>): string {
  const repo = join(DIR, 'repos', label);
  mkdirSync(repo, { recursive: true });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), body);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'Fixture');
  return repo;
}

export async function openChat(
  ctx: Ctx,
  label: string,
  repo: string,
  arm: string,
  level = 'full-auto',
): Promise<Chat> {
  const { provider, mode } = ARMS[arm]!;
  const projectId = await ctx.api.linkProject(repo, 'off', ['npm test']);
  const conversationId = randomUUID();
  await ctx.api.call('PATCH', `/conversations/${conversationId}/settings`, {
    projectIds: [projectId],
    provider,
    agentMode: mode,
    level,
    routing: 'auto',
  });
  const chat = { label, conversationId, projectId, repo, provider, mode };
  writeFileSync(join(DIR, 'evidence', `${label}.chat.json`), JSON.stringify(chat, null, 2));
  return chat;
}

export interface Mark {
  at: string;
  what: string;
  data?: unknown;
}

export class Log {
  marks: Mark[] = [];
  constructor(readonly label: string) {}
  mark(what: string, data?: unknown): void {
    const at = new Date().toISOString();
    this.marks.push({ at, what, ...(data === undefined ? {} : { data }) });
    console.log(
      `[${this.label}] ${at.slice(11, 23)} ${what}${data === undefined ? '' : ` ${JSON.stringify(data).slice(0, 300)}`}`,
    );
  }
}

export async function post(ctx: Ctx, chat: Chat, text: string): Promise<string> {
  const sent = await ctx.api.call<{ run: { id: string } }>(
    'POST',
    `/conversations/${chat.conversationId}/messages`,
    { id: randomUUID(), content: text, source: 'e2e' },
  );
  return sent.run.id;
}

interface QueueItem {
  id: string;
  content: string;
}

export async function enqueue(ctx: Ctx, chat: Chat, text: string): Promise<string> {
  const id = randomUUID();
  await ctx.api.call('POST', `/conversations/${chat.conversationId}/queue`, { id, content: text });
  return id;
}

export async function sendNow(
  ctx: Ctx,
  chat: Chat,
  text: string,
): Promise<{ id: string; outcome: string }> {
  const id = randomUUID();
  const reply = await ctx.api.call<{ outcome?: string }>(
    'POST',
    `/conversations/${chat.conversationId}/queue/send-now`,
    { id, content: text },
  );
  return { id, outcome: reply.outcome ?? '' };
}

export async function queued(ctx: Ctx, chat: Chat): Promise<QueueItem[]> {
  const reply = await ctx.api.call<{ queue: QueueItem[] }>(
    'GET',
    `/conversations/${chat.conversationId}/queue`,
  );
  return reply.queue;
}

export async function rows<T>(ctx: Ctx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await ctx.db.query(sql, params)).rows as T[];
}

const ACTIVE = `('queued','running','awaiting_approval')`;

export async function activeTop(ctx: Ctx, chat: Chat): Promise<string[]> {
  const found = await rows<{ id: string }>(
    ctx,
    `SELECT id FROM runs WHERE conversation_id = $1 AND parent_run_id IS NULL AND status IN ${ACTIVE}`,
    [chat.conversationId],
  );
  return found.map((row) => row.id);
}

export interface Child {
  id: string;
  role: string | null;
  status: string;
  label: string | null;
}

export async function running(ctx: Ctx, chat: Chat, role?: string): Promise<Child[]> {
  return rows<Child>(
    ctx,
    `SELECT id, role, status, agent_label AS label FROM runs
     WHERE conversation_id = $1 AND parent_run_id IS NOT NULL AND status = 'running'
       AND ($2::text IS NULL OR role = $2) ORDER BY created_at`,
    [chat.conversationId, role ?? null],
  );
}

const seenApprovals = new Set<string>();

export async function answerCards(
  ctx: Ctx,
  chat: Chat,
  log: Log,
  hold: (title: string) => boolean = () => false,
): Promise<void> {
  for (const approval of await ctx.api.pending(chat.conversationId)) {
    if (seenApprovals.has(approval.id)) continue;
    if (hold(approval.title)) continue;
    log.mark(`card ${approval.kind}: ${approval.title}`, {
      options: approval.options.map((option) => `${option.kind}:${option.name}`),
      reason: approval.reason,
    });
    seenApprovals.add(approval.id);
    await allow(ctx, approval);
  }
}

export async function allow(ctx: Ctx, approval: Approval, optionId?: string): Promise<void> {
  const option =
    approval.options.find((candidate) => candidate.optionId === optionId) ??
    approval.options.find((candidate) => candidate.kind === 'allow_once') ??
    approval.options[0]!;
  await ctx.api.call('POST', `/approvals/${approval.id}/decision`, {
    optionId: option.optionId,
    scope: 'once',
    payloadHash: approval.payloadHash,
  });
}

export async function waitUntil(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs: number,
  everyMs = 400,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(everyMs);
  }
  console.log(`TIMEOUT waiting for ${what}`);
  return false;
}

export async function waitIdle(
  ctx: Ctx,
  chat: Chat,
  log: Log,
  timeoutMs = 25 * 60_000,
  each: () => Promise<void> = async () => undefined,
  hold: (title: string) => boolean = () => false,
): Promise<boolean> {
  let quiet = 0;
  return waitUntil(
    `${chat.label} idle`,
    async () => {
      await each();
      await answerCards(ctx, chat, log, hold);
      const busy = (await activeTop(ctx, chat)).length > 0 || (await queued(ctx, chat)).length > 0;
      quiet = busy ? 0 : quiet + 1;
      return quiet >= 8;
    },
    timeoutMs,
    500,
  );
}

function agentProcesses(workerPid: number): { pid: number; rssMb: number; command: string }[] {
  const table = execFileSync('ps', ['-Ao', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssMb: Math.round(Number(match[3]) / 1024),
      command: match[4]!.slice(0, 160),
    }));
  const found: { pid: number; rssMb: number; command: string }[] = [];
  const pending = [workerPid];
  while (pending.length > 0) {
    const parent = pending.shift()!;
    for (const row of table.filter((candidate) => candidate.ppid === parent)) {
      found.push({ pid: row.pid, rssMb: row.rssMb, command: row.command });
      pending.push(row.pid);
    }
  }
  return found;
}

export function sampleMemory(ctx: Ctx, log: Log, tag: string): void {
  const found = agentProcesses(ctx.state.workerPid);
  log.mark(`ps ${tag}`, {
    processes: found.length,
    totalMb: found.reduce((sum, row) => sum + row.rssMb, 0),
    rows: found.map((row) => `${row.rssMb}MB ${row.command.replace(/\S*\//g, '').slice(0, 60)}`),
  });
}

export function orphanCount(ctx: Ctx): number {
  return agentProcesses(ctx.state.workerPid).length;
}

function tryRun(command: string, args: string[], cwd: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120_000,
    });
    return { ok: true, out: out.slice(-1500) };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}`.slice(-1500) };
  }
}

async function workFolders(ctx: Ctx, chat: Chat): Promise<string[]> {
  const found = await rows<{ root: string }>(
    ctx,
    `SELECT DISTINCT jsonb_array_elements_text(project_roots) AS root FROM runs
     WHERE conversation_id = $1 AND project_roots IS NOT NULL`,
    [chat.conversationId],
  ).catch(() => []);
  const sessions = await rows<{ cwd: string }>(
    ctx,
    'SELECT DISTINCT cwd FROM provider_sessions WHERE conversation_id = $1',
    [chat.conversationId],
  );
  const copies = await rows<{ path: string }>(
    ctx,
    'SELECT path FROM chat_worktrees WHERE conversation_id = $1',
    [chat.conversationId],
  ).catch(() => []);
  return [
    ...new Set([
      chat.repo,
      ...found.map((row) => row.root),
      ...sessions.map((row) => row.cwd),
      ...copies.map((row) => row.path),
    ]),
  ];
}

export async function dump(ctx: Ctx, chat: Chat, log: Log): Promise<void> {
  const id = [chat.conversationId];
  const runs = await rows(
    ctx,
    `SELECT id, parent_run_id, role, agent_label, step_index, attempt, status, error, provider,
       COALESCE(used_model, model) AS model, used_mode, agent_mode, mode, level, start_as, source,
       created_at, started_at, finished_at, duration_ms, tool_call_count, cost_usd, cost_source,
       input_tokens, output_tokens, cached_read_tokens, cached_write_tokens, total_tokens,
       route, left(prompt, 400) AS prompt_head, user_message_id, continues_run_id
     FROM runs WHERE conversation_id = $1 ORDER BY created_at`,
    id,
  );
  const firstOutput = await rows(
    ctx,
    `SELECT r.id, r.role,
       (SELECT min(l.at) FROM run_protocol_log l WHERE l.run_id = r.id AND l.direction = 'to_agent'
          AND l.method = 'session/prompt') AS prompt_at,
       (SELECT min(l.at) FROM run_protocol_log l WHERE l.run_id = r.id AND l.direction = 'from_agent'
          AND l.method = 'session/update' AND l.seq > (SELECT min(p.seq) FROM run_protocol_log p
            WHERE p.run_id = r.id AND p.direction = 'to_agent' AND p.method = 'session/prompt')
          AND l.payload::text ~ '(agent_message_chunk|agent_thought_chunk|tool_call)') AS first_update_at,
       (SELECT min(l.at) FROM run_protocol_log l WHERE l.run_id = r.id) AS first_log_at
     FROM runs r WHERE r.conversation_id = $1 ORDER BY r.created_at`,
    id,
  );
  const evidence = {
    chat,
    marks: log.marks,
    runs,
    firstOutput,
    eventTypes: await rows(
      ctx,
      `SELECT e.run_id, e.type, count(*)::int AS n FROM run_events e JOIN runs r ON r.id = e.run_id
       WHERE r.conversation_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`,
      id,
    ),
    approvals: await rows(
      ctx,
      `SELECT a.id, a.run_id, r.role, a.kind, a.title, a.status, a.reason, a.decided_by,
         a.decision_option_id, a.created_at, a.decided_at, a.options
       FROM approvals a JOIN runs r ON r.id = a.run_id WHERE r.conversation_id = $1 ORDER BY a.created_at`,
      id,
    ),
    railFlags: await rows(
      ctx,
      'SELECT * FROM rail_flags WHERE conversation_id = $1 ORDER BY created_at',
      id,
    ),
    sessionEvents: await rows(
      ctx,
      `SELECT e.at, e.event, e.reason, e.run_id, e.body, s.agent_key, s.provider, s.model
       FROM provider_session_events e LEFT JOIN provider_sessions s ON s.id = e.session_row_id
       WHERE e.conversation_id = $1 ORDER BY e.at`,
      id,
    ),
    sessions: await rows(
      ctx,
      `SELECT id, provider, agent_key, session_id, cwd, model, agent_mode, created_at, last_used_at,
         closed_at, close_reason, reported_cost_usd FROM provider_sessions WHERE conversation_id = $1
       ORDER BY created_at`,
      id,
    ),
    advice: await rows(
      ctx,
      `SELECT a.created_at, a.run_id, a.child_run_id, a.purpose, a.role, a.jev_status,
         a.jev_input_tokens, a.jev_cost_usd, a.body
       FROM run_advice a JOIN runs r ON r.id = a.run_id WHERE r.conversation_id = $1 ORDER BY a.created_at`,
      id,
    ),
    plans: await rows(
      ctx,
      `SELECT version, status, source, approved_option, approved_by, created_at, body
       FROM plan_documents WHERE conversation_id = $1 ORDER BY created_at`,
      id,
    ),
    pieceLists: await rows(
      ctx,
      `SELECT p.* FROM piece_lists p JOIN runs r ON r.id = p.orchestration_run_id
       WHERE r.conversation_id = $1 ORDER BY p.created_at`,
      id,
    ),
    pieces: await rows(
      ctx,
      `SELECT t.* FROM task_pieces t JOIN piece_lists p ON p.id = t.piece_list_id
       JOIN runs r ON r.id = p.orchestration_run_id WHERE r.conversation_id = $1`,
      id,
    ).catch((error: Error) => [{ error: error.message }]),
    pieceNotes: await rows(
      ctx,
      `SELECT n.* FROM piece_notes n JOIN piece_lists p ON p.id = n.piece_list_id
       JOIN runs r ON r.id = p.orchestration_run_id WHERE r.conversation_id = $1`,
      id,
    ).catch((error: Error) => [{ error: error.message }]),
    messages: await rows(
      ctx,
      'SELECT id, role, run_id, created_at, content FROM messages WHERE conversation_id = $1 ORDER BY created_at',
      id,
    ),
    memberMessages: await rows(
      ctx,
      'SELECT * FROM member_messages WHERE conversation_id = $1 ORDER BY created_at',
      id,
    ),
    queue: await rows(
      ctx,
      'SELECT * FROM chat_queue WHERE conversation_id = $1 ORDER BY position',
      id,
    ),
    observations: await rows(
      ctx,
      'SELECT run_id, source, label, created_at FROM run_observations WHERE conversation_id = $1 ORDER BY created_at',
      id,
    ),
    prompts: await rows(
      ctx,
      `SELECT l.run_id, r.role, r.agent_label, l.at, l.direction, l.method, l.size_bytes, l.truncated, l.payload
       FROM run_protocol_log l JOIN runs r ON r.id = l.run_id
       WHERE r.conversation_id = $1 AND l.method = 'session/prompt' ORDER BY l.at`,
      id,
    ),
    auditSummary: await ctx.api
      .call('GET', `/conversations/${chat.conversationId}/audit/summary`)
      .catch((error: Error) => ({ error: error.message })),
    git: {} as Record<string, unknown>,
  };
  const exported = await fetch(
    `${ctx.state.api}/conversations/${chat.conversationId}/audit/export.jsonl`,
    { headers: { 'x-spark-token': ctx.state.token } },
  ).catch(() => null);
  if (exported?.ok)
    writeFileSync(join(DIR, 'evidence', `${chat.label}.audit.jsonl`), await exported.text());
  for (const folder of await workFolders(ctx, chat)) {
    evidence.git[folder] = {
      branch: tryRun('git', ['branch', '--show-current'], folder).out.trim(),
      status: tryRun('git', ['status', '--porcelain'], folder).out,
      log: tryRun('git', ['log', '--oneline', '-12'], folder).out,
      test: tryRun('npm', ['test', '--silent'], folder),
    };
  }
  evidence.git.branches = tryRun('git', ['branch', '-a', '-vv'], chat.repo).out;
  evidence.git.worktrees = tryRun('git', ['worktree', 'list'], chat.repo).out;
  writeFileSync(join(DIR, 'evidence', `${chat.label}.json`), JSON.stringify(evidence, null, 1));
  console.log(`[${chat.label}] evidence saved`);
}
