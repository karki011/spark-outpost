import { join } from 'node:path';
import type { Browser } from '@playwright/test';
import type { Orchestration } from '../../packages/contracts/src/index.ts';
import type { LaneOptions } from '../../apps/server/src/orchestration/placement.ts';
import { runLiveCell, type BenchEnv } from '../bench/live.ts';
import {
  Api,
  openApiChat,
  sendApiTurn,
  type Chat,
  type TurnOptions,
  type TurnOutcome,
  type UiNote,
} from './api-driver.ts';
import { benchEnv } from './bench-env.ts';
import { builderStartedAt, cleanupProblems } from './cleanup.ts';
import { collectTurn, type OrchestrationLoader } from './collect.ts';
import { directClaudeTurns, directCodexTurns } from './direct.ts';
import type { Cell } from './plan.ts';
import type { TurnRecord } from './results.ts';
import { setConnections } from './seed.ts';
import type { Runtime, Stack } from './stack.ts';
import { newUiSession, openUiChat, sendUiTurn, startFreshInUi } from './ui-driver.ts';

export interface ArmContext {
  runtime: Runtime;
  dir: string;
  timeoutMs: number;
  stack: (cell: Cell) => Promise<Stack>;
  browser: () => Promise<Browser>;
  benches: Map<string, BenchEnv>;
}

export interface ArmResult {
  turns: TurnRecord[];
  consoleErrors: string[];
  notes: UiNote[];
  cleanup: string[] | null;
}

function withTags(ctx: ArmContext, cell: Cell, text: string): string {
  return ctx.runtime === 'fake' ? `${text}${cell.scenario.fakeTags}` : text;
}

async function bench(ctx: ArmContext, key: string, lanes: LaneOptions): Promise<BenchEnv> {
  const existing = ctx.benches.get(key);
  if (existing) return existing;
  const env = await benchEnv(ctx.runtime, lanes);
  ctx.benches.set(key, env);
  return env;
}

function loader(stack: Stack, api: Api): OrchestrationLoader | undefined {
  if (stack.version === 'current') return undefined;
  return async (runId) => (await api.orchestration(runId)) as Orchestration | null;
}

function turnOptions(ctx: ArmContext, cell: Cell, stack: Stack): TurnOptions {
  return {
    timeoutMs: ctx.timeoutMs,
    cancelAfterBuilderMs: cell.scenario.cancelAfterBuilderMs ?? null,
    builderStartedAt: (runId) => builderStartedAt(stack.db, runId),
  };
}

async function record(stack: Stack, api: Api, text: string, outcome: TurnOutcome) {
  const metrics = await collectTurn(stack.db, outcome.runId, outcome.wallMs, loader(stack, api));
  return { prompt: text, metrics, outcome, autoDenied: 0 };
}

async function cleanupAfter(stack: Stack, chat: Chat, runId: string): Promise<string[]> {
  await new Promise((done) => setTimeout(done, 15_000));
  return cleanupProblems(stack.db, runId, chat.conversationId, chat.repo, stack.workerPid);
}

async function harnessOnStack(ctx: ArmContext, cell: Cell, repo: string): Promise<ArmResult> {
  const stack = await ctx.stack(cell);
  const api = new Api(stack.urls.api);
  const { setup, scenario } = cell;
  await setConnections(stack.db, stack.workspaceId, {
    jev: setup.jev,
    codex: setup.codexConnected,
    zai: setup.provider === 'zai',
  });
  const notes: UiNote[] = [];
  const turns: TurnRecord[] = [];
  const options = turnOptions(ctx, cell, stack);
  const prefix = `${scenario.id}-${cell.variant}`;
  const session =
    setup.driver === 'ui'
      ? await newUiSession(await ctx.browser(), api, stack.urls.web, join(ctx.dir, 'shots'), prefix)
      : null;
  try {
    const chat: Chat = session
      ? await openUiChat(session, repo, setup, scenario.checkCommands, notes)
      : await openApiChat(api, repo, setup, scenario.checkCommands);
    for (const [index, text] of scenario.turns.entries()) {
      const last = index === scenario.turns.length - 1;
      if (index > 0 && last && setup.freshBeforeLastTurn) {
        if (session) await startFreshInUi(session, notes);
        else await api.startFresh(chat.conversationId);
      }
      const tagged = withTags(ctx, cell, text);
      const outcome = session
        ? await sendUiTurn(session, stack.db, chat, tagged, options)
        : await sendApiTurn(api, chat, tagged, options);
      turns.push(await record(stack, api, text, outcome));
    }
    const lastRun = turns.at(-1)?.metrics.runId;
    const cleanup =
      scenario.task.verify === 'cleanup' && lastRun
        ? await cleanupAfter(stack, chat, lastRun)
        : null;
    return { turns, consoleErrors: session?.consoleErrors ?? [], notes, cleanup };
  } finally {
    await session?.page.context().close();
    await setConnections(stack.db, stack.workspaceId, { jev: true, codex: true, zai: false });
  }
}

async function harnessBench(ctx: ArmContext, cell: Cell, repo: string): Promise<ArmResult> {
  const { placement, buildStyle } = cell.setup;
  const lanes: LaneOptions = placement === 'jev' ? {} : { placement, split: 'any' };
  const env = await bench(ctx, `harness-${placement}`, lanes);
  const text = cell.scenario.turns[0]!;
  const tagged = withTags(ctx, cell, text);
  const live = await runLiveCell(env, 'harness', repo, tagged, ctx.timeoutMs, buildStyle);
  const metrics = await collectTurn(env.t.db, live.runId, live.wallMs);
  const autoDenied = live.asked.filter((item) => item.autoDenied).length;
  return {
    turns: [{ prompt: text, metrics, outcome: null, autoDenied }],
    consoleErrors: [],
    notes: [],
    cleanup: null,
  };
}

export async function runArm(ctx: ArmContext, cell: Cell, repo: string): Promise<ArmResult> {
  const prompts = cell.scenario.turns.map((text) => withTags(ctx, cell, text));
  const toRecords = (turns: Awaited<ReturnType<typeof directCodexTurns>>): ArmResult => ({
    turns: turns.map((turn, index) => ({
      prompt: cell.scenario.turns[index]!,
      metrics: turn.metrics,
      outcome: null,
      autoDenied: turn.autoDenied,
    })),
    consoleErrors: [],
    notes: [],
    cleanup: null,
  });
  if (cell.arm === 'direct-claude') {
    const env = await bench(ctx, 'direct', {});
    return toRecords(await directClaudeTurns(env, repo, prompts, ctx.timeoutMs));
  }
  if (cell.arm === 'direct-codex') {
    return toRecords(await directCodexTurns(repo, prompts, ctx.timeoutMs, cell.codexEffort));
  }
  if (cell.setup.driver === 'bench') return harnessBench(ctx, cell, repo);
  return harnessOnStack(ctx, cell, repo);
}
