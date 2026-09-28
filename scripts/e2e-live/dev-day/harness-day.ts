import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type {
  AnnotationInput,
  Approval,
  ConversationDetail,
} from '../../../packages/contracts/src/index.ts';
import { planDocuments } from '../../../apps/server/src/persistence/plan-documents.ts';
import { looksLikePlan } from '../../../packages/contracts/src/plans.ts';
import { agentUsage } from '../../bench/metrics.ts';
import { Api, sleep, type Answered, type Chat, type TurnOutcome } from '../api-driver.ts';
import { balancedChoice } from '../balanced.ts';
import { builderStartedAt } from '../cleanup.ts';
import { collectTurn, type TurnMetrics } from '../collect.ts';
import type { Stack } from '../stack.ts';
import { AGREED_PLAN_MARKER, levelSettings } from './levels.ts';
import type { DayRepo } from './repos.ts';
import { REPO_CHECKS, type DaySession } from './sessions.ts';
import type { ArmDay, ArmSessionResult, PreparedTurn, TurnLog } from './arm.ts';
import type { Intervention } from './score.ts';

const CHECKPOINT_KINDS_SQL = `(kind NOT IN ('edit', 'execute', 'other') OR payload ? 'plan')`;
const TOOL_KINDS = new Set(['edit', 'execute', 'other']);
const TOP_TIER_MODEL = /opus|astra/i;
export const ANSWERED_CLARIFY_REPLY_CHARS = 400;
const RECANCEL_MS = 5_000;
const NO_BUILDER_GRACE_MS = 60_000;

interface TurnRun {
  outcome: TurnOutcome;
  stoppedOnClarify: boolean;
  cappedAtUsd: number | null;
}

export interface HarnessDayOptions {
  timeoutMs: number;
  shotsDir: string | null;
  browser: (() => Promise<Browser>) | null;
}

async function childIds(stack: Stack, runId: string): Promise<string[]> {
  const { rows } = await stack.db.query<{ id: string }>(
    'SELECT id FROM runs WHERE id = $1 OR parent_run_id = $1',
    [runId],
  );
  return rows.map((row) => row.id);
}

async function rolePrompts(stack: Stack, ids: string[], role: string): Promise<string[]> {
  const { rows } = await stack.db.query<{ prompt: string | null }>(
    'SELECT prompt FROM runs WHERE id = ANY($1) AND role = $2 ORDER BY created_at',
    [ids, role],
  );
  return rows.map((row) => row.prompt ?? '');
}

async function planCards(stack: Stack, ids: string[]): Promise<number> {
  const { rows } = await stack.db.query<{ count: string }>(
    `SELECT count(*) FROM approvals WHERE run_id = ANY($1) AND (kind = 'plan' OR payload ? 'plan')`,
    [ids],
  );
  return Number(rows[0]?.count ?? 0);
}

async function cardBeforeBuilder(stack: Stack, ids: string[]): Promise<boolean | null> {
  const { rows } = await stack.db.query<{ card: Date | null; builder: Date | null }>(
    `SELECT (SELECT min(created_at) FROM approvals WHERE run_id = ANY($1) AND ${CHECKPOINT_KINDS_SQL}) AS card,
       (SELECT min(started_at) FROM runs WHERE id = ANY($1) AND role = 'builder') AS builder`,
    [ids],
  );
  const row = rows[0];
  if (!row?.card) return false;
  return !row.builder || row.card.getTime() <= row.builder.getTime();
}

async function handedOff(stack: Stack, ids: string[]): Promise<boolean | null> {
  const { rows } = await stack.db.query<{ count: string }>(
    `SELECT count(*) FROM run_events WHERE run_id = ANY($1)
       AND payload::text ~* '(context hand-?off|handed off the context|handoff)'`,
    [ids],
  );
  return Number(rows[0]?.count ?? 0) > 0 ? true : null;
}

function interventionsFrom(answered: readonly Answered[]): {
  list: Intervention[];
  clicks: number;
} {
  const list: Intervention[] = [];
  let clicks = 0;
  for (const item of answered) {
    if (TOOL_KINDS.has(item.kind)) clicks += 1;
    else list.push({ kind: 'checkpoint', text: `${item.kind}: ${item.label}` });
  }
  return { list, clicks };
}

function toAnnotation(turn: PreparedTurn): AnnotationInput[] {
  if (!turn.quote?.messageId) return [];
  return [
    {
      id: randomUUID(),
      sourceMessageId: turn.quote.messageId,
      kind: 'ask',
      quote: turn.quote.passage,
      note: '',
      anchor: turn.quote.anchor,
    },
  ];
}

export class HarnessDay implements ArmDay {
  readonly arm = 'harness' as const;
  private readonly api: Api;
  private readonly projects = new Map<string, string>();
  private readonly chats = new Map<string, Chat>();

  constructor(
    private readonly stack: Stack,
    private readonly options: HarnessDayOptions,
  ) {
    this.api = new Api(stack.urls.api, stack.apiToken);
  }

  private async project(
    repo: DayRepo,
    sessionChecks: readonly string[] | undefined,
  ): Promise<string> {
    const checks = sessionChecks ?? REPO_CHECKS[repo.key];
    const known = this.projects.get(repo.path);
    if (known) {
      if (checks) await this.api.call('PATCH', `/projects/${known}`, { checkCommands: checks });
      return known;
    }
    const id = await this.api.linkProject(repo.path, 'off', checks);
    this.projects.set(repo.path, id);
    return id;
  }

  private async chat(session: DaySession, repo: DayRepo): Promise<Chat> {
    const projectId = await this.project(repo, session.checks);
    const existing = this.chats.get(session.thread);
    const chat = existing ?? { conversationId: randomUUID(), projectId, repo: repo.path };
    await this.api.call('PATCH', `/conversations/${chat.conversationId}/settings`, {
      projectIds: [projectId],
      provider: 'claude',
      ...levelSettings(session.level, 'claude'),
      routing: 'auto',
    });
    this.chats.set(session.thread, chat);
    return chat;
  }

  private async sendTurn(
    chat: Chat,
    turn: PreparedTurn,
    session: DaySession,
    capUsd: number,
  ): Promise<TurnRun> {
    const started = Date.now();
    const sent = await this.api.call<{ run: { id: string } }>(
      'POST',
      `/conversations/${chat.conversationId}/messages`,
      { id: randomUUID(), content: turn.text, annotations: toAnnotation(turn) },
    );
    const runId = sent.run.id;
    const outcome: TurnOutcome = {
      runId,
      wallMs: 0,
      timedOut: false,
      cancelledAtMs: null,
      answered: [],
      notes: [],
    };
    let stoppedOnClarify = false;
    let cappedAtUsd: number | null = null;
    let polls = 0;
    let lastCancel = 0;
    const cancel = async () => {
      if (outcome.cancelledAtMs === null) outcome.cancelledAtMs = Date.now() - started;
      lastCancel = Date.now();
      await this.api.cancel(runId).catch(() => undefined);
    };
    while (!(await this.api.finished(runId))) {
      polls += 1;
      for (const approval of await this.api.pending(chat.conversationId)) {
        if (session.policy === 'stop-on-clarify' && approval.kind === 'clarify') {
          stoppedOnClarify = true;
          await cancel();
          break;
        }
        const choice = balancedChoice(
          approval as Approval,
          session.expect.kind === 'build' ? 'change' : 'answer',
        );
        if (choice.waitForAuto) continue;
        await this.api.decide(approval, choice).catch(() => undefined);
        outcome.answered.push({
          kind: approval.kind,
          label: choice.label,
          via: 'api',
          why: choice.why,
        });
      }
      if (turn.interruptAfterMs !== null && outcome.cancelledAtMs === null) {
        const builder = await builderStartedAt(this.stack.db, runId);
        const since = builder ?? started + NO_BUILDER_GRACE_MS;
        if (Date.now() - since >= turn.interruptAfterMs) await cancel();
      }
      if (outcome.cancelledAtMs !== null && Date.now() - lastCancel > RECANCEL_MS) await cancel();
      if (polls % 10 === 0 && cappedAtUsd === null) {
        const spent = (await agentUsage(this.stack.db, runId).catch(() => [])).reduce(
          (sum, agent) => sum + agent.costUsd,
          0,
        );
        if (spent > capUsd) {
          cappedAtUsd = spent;
          await cancel();
        }
      }
      if (!outcome.timedOut && Date.now() - started > this.options.timeoutMs) {
        outcome.timedOut = true;
        await cancel();
      }
      await sleep(500);
    }
    outcome.wallMs = Date.now() - started;
    return { outcome, stoppedOnClarify, cappedAtUsd };
  }

  async replyMessageId(thread: string, runId: string): Promise<string | null> {
    const chat = this.chats.get(thread);
    if (!chat) return null;
    const detail = await this.api.call<ConversationDetail>(
      'GET',
      `/conversations/${chat.conversationId}`,
    );
    const message = detail.messages.findLast(
      (candidate) => candidate.role === 'assistant' && candidate.runId === runId,
    );
    return message?.id ?? null;
  }

  private async savePlan(chat: Chat, thread: string, lastRunId: string, reply: string) {
    const saved = await planDocuments(this.stack.db, chat.conversationId);
    if (saved.some((plan) => plan.status === 'approved'))
      return { how: 'auto' as const, extra: [] };
    const detail = await this.api.call<ConversationDetail>(
      'GET',
      `/conversations/${chat.conversationId}`,
    );
    const offer = detail.plans?.offers.at(-1);
    if (offer) {
      await this.api.call('POST', `/conversations/${chat.conversationId}/plans`, {
        messageId: offer.messageId,
        offered: true,
      });
      const extra: Intervention[] = [{ kind: 'save-plan', text: 'clicked "Save as agreed plan"' }];
      return { how: 'offer' as const, extra };
    }
    const messageId = await this.replyMessageId(thread, lastRunId);
    if (!messageId || !looksLikePlan(reply)) return { how: 'none' as const, extra: [] };
    await this.api.call('POST', `/conversations/${chat.conversationId}/plans`, {
      messageId,
      offered: false,
    });
    const extra: Intervention[] = [
      { kind: 'save-plan', text: 'saved the reply as the plan by hand' },
    ];
    return { how: 'manual' as const, extra };
  }

  private shipAvailable(): boolean {
    return existsSync(join(this.stack.appRoot, 'apps/server/src/api/ship-routes.ts'));
  }

  private async screenshot(
    session: DaySession,
    chat: Chat,
    firstText: string,
  ): Promise<string | null> {
    if (!this.options.shotsDir || !this.options.browser || !this.stack.urls.web) return null;
    const browser = await this.options.browser();
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    try {
      const page = await context.newPage();
      await page.goto(this.stack.urls.web);
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: /^Chats/ })
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      await page
        .getByText(firstText.slice(0, 24), { exact: false })
        .first()
        .click({ timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);
      const path = join(this.options.shotsDir, `dev-day-${session.id}-harness.png`);
      await page.screenshot({ path });
      return path;
    } catch {
      return null;
    } finally {
      await context.close();
      void chat;
    }
  }

  async run(
    session: DaySession,
    repo: DayRepo,
    turns: readonly PreparedTurn[],
    capUsd: number,
  ): Promise<ArmSessionResult> {
    const chat = await this.chat(session, repo);
    if (session.freshSession) await this.api.startFresh(chat.conversationId);
    const logs: TurnLog[] = [];
    const answered: Answered[] = [];
    let stoppedOnClarify = false;
    let cappedAtUsd: number | null = null;
    let timedOut = false;
    for (const turn of turns) {
      const result = await this.sendTurn(chat, turn, session, capUsd);
      const metrics: TurnMetrics = await collectTurn(
        this.stack.db,
        result.outcome.runId,
        result.outcome.wallMs,
      );
      logs.push({ prompt: turn.text, metrics, interrupted: result.outcome.cancelledAtMs !== null });
      answered.push(...result.outcome.answered);
      stoppedOnClarify ||= result.stoppedOnClarify;
      cappedAtUsd ??= result.cappedAtUsd;
      timedOut ||= result.outcome.timedOut;
      if (result.stoppedOnClarify) break;
    }
    const runIds = logs.map((log) => log.metrics.runId);
    const ids = (await Promise.all(runIds.map((id) => childIds(this.stack, id)))).flat();
    const agents = logs.flatMap((log) => log.metrics.agents);
    const builders = await rolePrompts(this.stack, ids, 'builder');
    const critics = await rolePrompts(this.stack, ids, 'critic');
    const reply = logs.at(-1)?.metrics.reply ?? '';
    const lastRunId = runIds.at(-1) ?? '';
    const planCard = (await planCards(this.stack, ids)) > 0;
    const plan = session.savePlan
      ? await this.savePlan(chat, session.thread, lastRunId, reply)
      : null;
    const { list, clicks } = interventionsFrom(answered);
    const clarifyCard =
      stoppedOnClarify ||
      (logs.some((log) => log.metrics.approvals.some((a) => a.kind === 'clarify')) &&
        (logs.at(-1)?.metrics.reply ?? '').trim().length < ANSWERED_CLARIFY_REPLY_CHARS);
    const secondTurn = logs[1];
    const resumed = secondTurn
      ? secondTurn.metrics.sessionNotes.some((note) => note.startsWith('Continued session')) ||
        builders.some((prompt) => prompt.includes('You stopped before finishing'))
      : null;
    const findings = logs.flatMap((log) =>
      log.metrics.reviews.flatMap((review) => review.findings),
    );
    const shot = await this.screenshot(session, chat, turns[0]?.text ?? '').catch(() => null);
    return {
      logs,
      reply,
      replyMessageId: await this.replyMessageId(session.thread, lastRunId),
      reviewText: [reply, ...findings].join('\n'),
      timedOut,
      error: logs.find((log) => log.metrics.error)?.metrics.error ?? null,
      cappedAtUsd,
      clarifyCard,
      planCard,
      planSaved: plan?.how ?? null,
      roles: [...new Set(agents.map((agent) => agent.role))],
      checksRan: logs.reduce((sum, log) => sum + log.metrics.checks.length, 0),
      builderPlanLoaded:
        builders.length === 0 ? null : builders.some((p) => p.includes(AGREED_PLAN_MARKER)),
      criticPlanLoaded:
        critics.length === 0 ? null : critics.some((p) => p.includes(AGREED_PLAN_MARKER)),
      topTier: agents.some(
        (agent) =>
          ['architect', 'builder'].includes(agent.role) && TOP_TIER_MODEL.test(agent.model ?? ''),
      ),
      worktrees: Math.max(0, ...logs.map((log) => log.metrics.lanes.worktrees)),
      cardFirst: await cardBeforeBuilder(this.stack, ids),
      builders: agents.filter((agent) => agent.role === 'builder').length,
      parallelBuilders: Math.max(0, ...logs.map((log) => log.metrics.lanes.parallelBuilders)),
      handoff: await handedOff(this.stack, ids),
      resumed,
      shipAvailable: session.ship ? this.shipAvailable() : null,
      interventions: [...list, ...(plan?.extra ?? [])],
      clicks,
      shots: shot ? [shot] : [],
      conversation: chat.conversationId,
    };
  }

  async close(): Promise<void> {}
}
