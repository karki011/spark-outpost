import { BASE } from './fixtures.ts';
import { BIGGER } from './prompts.ts';
import {
  activeTop,
  dump,
  post,
  rows,
  running,
  sampleMemory,
  sleep,
  waitIdle,
  waitUntil,
} from './lib.ts';
import { builders, chatFor, ctx, label, log, planCard, turn, type Scenarios } from './scn-kit.ts';

export const planAndStopScenarios: Scenarios = {
  async G() {
    const chat = await chatFor(BASE);
    await turn(
      chat,
      '/plan Add src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max) with test/clamp.test.ts using node:test.',
    );
    return chat;
  },
  async GQ() {
    const chat = await chatFor(BASE);
    await turn(
      chat,
      'What does capitalize in src/strings.ts do with an empty string? One sentence.',
    );
    return chat;
  },
  async GH() {
    const chat = await chatFor(BASE);
    const runId = await post(
      ctx,
      chat,
      '/plan Add src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max) with test/clamp.test.ts using node:test.',
    );
    log.mark(`sent ${runId}`);
    let held = 0;
    await waitIdle(
      ctx,
      chat,
      log,
      15 * 60_000,
      async () => {
        const pending = await ctx.api.pending(chat.conversationId);
        const plan = pending.find((approval) => /plan/i.test(approval.title));
        if (plan && held === 0) {
          held = Date.now();
          log.mark(`plan card held: ${plan.kind} "${plan.title}" on run role`, plan.options);
        }
      },
      (title) => /plan/i.test(title) && (held === 0 || Date.now() - held < 12_000),
    );
    return chat;
  },
  async GO() {
    const chat = await chatFor(BASE);
    const want = new RegExp(process.env.PLAN_OPTION ?? 'allow_once', 'i');
    const runId = await post(
      ctx,
      chat,
      '/plan Add src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max) with test/clamp.test.ts using node:test.',
    );
    log.mark(`sent ${runId}`);
    await planCard(chat, want);
    return chat;
  },
  async GB() {
    const chat = await chatFor(BASE);
    const runId = await post(
      ctx,
      chat,
      'Add src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max) with test/clamp.test.ts using node:test.',
    );
    log.mark(`sent ${runId}`);
    await planCard(chat, new RegExp(process.env.PLAN_OPTION ?? 'allow_once', 'i'));
    return chat;
  },
  async GP() {
    const chat = await chatFor(BASE);
    await turn(
      chat,
      'What does capitalize in src/strings.ts do with an empty string? One sentence.',
    );
    const runId = await post(
      ctx,
      chat,
      'Add src/clamp.ts exporting clamp(value: number, min: number, max: number): number (throws RangeError when min > max) with test/clamp.test.ts using node:test.',
    );
    log.mark(`sent ${runId}`);
    await planCard(chat, new RegExp(process.env.PLAN_OPTION ?? 'allow_once', 'i'));
    return chat;
  },
  async HS() {
    const chat = await chatFor(BASE);
    const runId = await post(ctx, chat, BIGGER);
    log.mark(`sent ${runId}`);
    await builders(chat, 3);
    await sleep(10_000);
    sampleMemory(ctx, log, 'before stop');
    await ctx.api.cancel(runId);
    log.mark('stop requested');
    await waitUntil('stopped', async () => (await activeTop(ctx, chat)).length === 0, 120_000);
    log.mark('top run ended');
    await sleep(3_000);
    sampleMemory(ctx, log, '3 s after stop');
    await sleep(7_000);
    sampleMemory(ctx, log, '10 s after stop');
    log.mark(
      'queue and runs',
      await rows(
        ctx,
        'SELECT role, agent_label, status FROM runs WHERE conversation_id = $1 ORDER BY created_at',
        [chat.conversationId],
      ),
    );
    return chat;
  },
  async H() {
    const chat = await chatFor(BASE);
    const runId = await post(ctx, chat, BIGGER);
    log.mark(`sent ${runId}`);
    await builders(chat, 2);
    await sleep(20_000);
    sampleMemory(ctx, log, 'before stop');
    log.mark('running before stop', await running(ctx, chat));
    await ctx.api.cancel(runId);
    log.mark('stop requested');
    await waitUntil('stopped', async () => (await activeTop(ctx, chat)).length === 0, 120_000);
    log.mark('top run ended');
    await sleep(10_000);
    sampleMemory(ctx, log, '10 s after stop');
    log.mark(
      'runs after stop',
      await rows(
        ctx,
        'SELECT role, agent_label, status, error FROM runs WHERE conversation_id = $1 ORDER BY created_at',
        [chat.conversationId],
      ),
    );
    await dump(ctx, { ...chat, label: `${label}-stopped` }, log);
    await turn(
      chat,
      'Carry on with the build you were stopped in: finish the remaining modules and tests.',
    );
    return chat;
  },
};
