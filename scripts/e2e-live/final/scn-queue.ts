import { BASE } from './fixtures.ts';
import { BIGGER, PARALLEL } from './prompts.ts';
import {
  activeTop,
  answerCards,
  enqueue,
  orphanCount,
  post,
  queued,
  rows,
  running,
  sampleMemory,
  sendNow,
  sleep,
  waitIdle,
  waitUntil,
} from './lib.ts';
import { builders, chatFor, ctx, log, memberStates, turn, type Scenarios } from './scn-kit.ts';

export const queueScenarios: Scenarios = {
  async E() {
    const chat = await chatFor(BASE);
    const runId = await post(ctx, chat, BIGGER);
    log.mark(`sent ${runId}`);
    if (!(await builders(chat, 2))) log.mark('never saw 2 builders running');
    await sleep(6_000);
    sampleMemory(ctx, log, 'builders running');
    log.mark('running', await running(ctx, chat));
    log.mark(
      'send-now question',
      await sendNow(
        ctx,
        chat,
        'Quick question while you work: which pieces are in this build and which are still running?',
      ),
    );
    await sleep(12_000);
    log.mark('running', await running(ctx, chat));
    log.mark(
      'send-now requirement',
      await sendNow(
        ctx,
        chat,
        'Also make sure slugify in src/slugify.ts turns "&" into the word "and", and add a test for that in test/slugify.test.ts.',
      ),
    );
    await sleep(8_000);
    log.mark(
      'send-now unrelated',
      await sendNow(
        ctx,
        chat,
        'Unrelated to this build: add reverse(text: string): string to src/strings.ts with a test in test/strings.test.ts.',
      ),
    );
    await sleep(5_000);
    log.mark('member messages', await memberStates(chat));
    log.mark('queue', await queued(ctx, chat));
    await waitIdle(ctx, chat, log);
    log.mark('member messages at end', await memberStates(chat));
    return chat;
  },
  async F() {
    const chat = await chatFor(BASE);
    const first = await post(
      ctx,
      chat,
      'Add repeat(text: string, times: number): string to src/strings.ts (throws RangeError for negative times) with tests in test/strings.test.ts.',
    );
    log.mark(`F1 sent ${first}`);
    await sleep(3_000);
    log.mark(
      'F1 queued',
      await enqueue(
        ctx,
        chat,
        'Now add isBlank(text: string): boolean to src/strings.ts with a test.',
      ),
    );
    log.mark('F1 queue', await queued(ctx, chat));
    await waitIdle(ctx, chat, log);
    log.mark('F1 done');
    const second = await post(
      ctx,
      chat,
      'Add a "## Strings" section to README.md listing every function exported from src/strings.ts.',
    );
    log.mark(`F2 sent ${second}`);
    await sleep(2_000);
    const q1 = await enqueue(
      ctx,
      chat,
      'Queue one: add countWords(text: string): number to src/strings.ts with a test.',
    );
    const q2 = await enqueue(
      ctx,
      chat,
      'Queue two: what did queue one add? Answer in one sentence, change nothing.',
    );
    const q3 = await enqueue(
      ctx,
      chat,
      'Queue three: add the line "Queue three was here." at the end of README.md.',
    );
    const q4 = await enqueue(ctx, chat, 'Queue four: THIS TEXT SHOULD BE EDITED before it runs.');
    const q5 = await enqueue(
      ctx,
      chat,
      'Queue five: THIS MESSAGE SHOULD BE REMOVED and never run.',
    );
    await ctx.api.call('PATCH', `/conversations/${chat.conversationId}/queue/${q4}`, {
      content:
        'Queue four (edited): add the line "Queue four was edited." at the end of README.md.',
    });
    await ctx.api.call('DELETE', `/conversations/${chat.conversationId}/queue/${q5}`);
    log.mark('F2 queue after edit and remove', {
      ids: { q1, q2, q3, q4, q5 },
      queue: await queued(ctx, chat),
    });
    await waitIdle(ctx, chat, log);
    log.mark('F2 done');
    const third = await post(
      ctx,
      chat,
      'Add a "## Testing" section to README.md that explains in about 150 words how the tests run, and add a test/readme.test.ts that checks README.md mentions every exported function of src/strings.ts.',
    );
    log.mark(`F4 sent ${third}`);
    await sleep(6_000);
    const held = await enqueue(
      ctx,
      chat,
      'Queued before Stop: add the line "Sent after stop." at the end of README.md.',
    );
    log.mark('F4 queue before stop', await queued(ctx, chat));
    await ctx.api.cancel(third);
    log.mark('F4 stop requested');
    await waitUntil('stopped', async () => (await activeTop(ctx, chat)).length === 0, 90_000);
    log.mark('F4 stopped; queue', await queued(ctx, chat));
    await sleep(25_000);
    log.mark('F4 25 s later: queue and active', {
      held,
      queue: await queued(ctx, chat),
      active: await activeTop(ctx, chat),
      orphans: orphanCount(ctx),
    });
    await turn(chat, 'Carry on: finish the README Testing section and its test.');
    log.mark('F4 after the next message; queue', await queued(ctx, chat));
    return chat;
  },
  async F3() {
    const chat = await chatFor(BASE);
    const runId = await post(
      ctx,
      chat,
      `${PARALLEL}\n1. src/clamp.ts exporting clamp(value: number, min: number, max: number): number, with test/clamp.test.ts.\n2. src/sum.ts exporting sum(values: readonly number[]): number, with test/sum.test.ts.\n\`npm test\` must pass.`,
    );
    log.mark(`sent ${runId}`);
    await builders(chat, 1);
    await waitUntil(
      'last piece finished',
      async () => {
        await answerCards(ctx, chat, log);
        const pieces = await rows<{ status: string }>(
          ctx,
          `SELECT t.status FROM task_pieces t JOIN piece_lists p ON p.id = t.piece_list_id
           WHERE p.orchestration_run_id = $1`,
          [runId],
        );
        const live = await running(ctx, chat, 'builder');
        return pieces.length > 0 && live.length === 0;
      },
      10 * 60_000,
      150,
    );
    log.mark(
      'pieces at send',
      await rows(
        ctx,
        `SELECT t.key, t.status FROM task_pieces t JOIN piece_lists p ON p.id = t.piece_list_id WHERE p.orchestration_run_id = $1`,
        [runId],
      ),
    );
    log.mark(
      'send-now as the last piece finishes',
      await sendNow(
        ctx,
        chat,
        'Also add a one-line "## Numbers" section to README.md naming clamp and sum.',
      ),
    );
    log.mark('member messages', await memberStates(chat));
    await waitIdle(ctx, chat, log);
    log.mark('member messages at end', await memberStates(chat));
    return chat;
  },
};
