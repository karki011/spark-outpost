import { BASE, LINKED } from './fixtures.ts';
import { PARALLEL, FOUR, BIGGER, MIXED, COLLISION, CROSS, MAPPED } from './prompts.ts';
import {
  activeTop,
  answerCards,
  connect,
  dump,
  enqueue,
  Log,
  makeRepo,
  openChat,
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
  type Chat,
} from './lib.ts';

const [scenario = '', arm = 'claude-auto', tag = ''] = process.argv.slice(2);
const label = `${scenario}-${arm}${tag ? `-${tag}` : ''}`;
const ctx = connect();
const log = new Log(label);

async function mapStatus(chat: Chat): Promise<unknown> {
  return rows(ctx, 'SELECT status, phase FROM map_repos WHERE root_path = $1', [chat.repo]).catch(
    (error: Error) => error.message,
  );
}

async function turn(chat: Chat, text: string, timeoutMs?: number): Promise<string> {
  log.mark('map', await mapStatus(chat));
  const runId = await post(ctx, chat, text);
  log.mark(`sent ${runId}`, text.slice(0, 80));
  let sampled = 0;
  await waitIdle(ctx, chat, log, timeoutMs, async () => {
    const live = await running(ctx, chat);
    if (live.length > sampled) {
      sampled = live.length;
      await sleep(4_000);
      sampleMemory(
        ctx,
        log,
        `${live.length} child runs (${live.map((run) => run.role).join(',')})`,
      );
    }
  });
  log.mark(`idle after ${runId}`);
  return runId;
}

async function chatFor(files: Record<string, string>, level?: string): Promise<Chat> {
  const repo = makeRepo(label, files);
  const chat = await openChat(ctx, label, repo, arm, level);
  log.mark('chat', chat);
  return chat;
}

async function builders(chat: Chat, atLeast: number, timeoutMs = 6 * 60_000): Promise<boolean> {
  return waitUntil(
    `${atLeast} builders running`,
    async () => {
      await answerCards(ctx, chat, log);
      return (await running(ctx, chat, 'builder')).length >= atLeast;
    },
    timeoutMs,
  );
}

async function memberStates(chat: Chat): Promise<unknown> {
  return rows(
    ctx,
    'SELECT id, body, urgency, status, delivered_run_id, message_id FROM member_messages WHERE conversation_id = $1 ORDER BY created_at',
    [chat.conversationId],
  );
}

const scenarios: Record<string, () => Promise<Chat>> = {
  async J() {
    const chat = await chatFor(BASE);
    await turn(
      chat,
      'What does capitalize in src/strings.ts return for an empty string? One sentence.',
    );
    await turn(
      chat,
      'In src/strings.ts add shout(text: string): string that returns the text upper-cased with a trailing "!", and add a test for it in test/strings.test.ts.',
    );
    await turn(
      chat,
      'Which file did you just change, and how many tests does the repo have now? One sentence.',
    );
    return chat;
  },
  async A() {
    const chat = await chatFor(BASE);
    await turn(chat, FOUR);
    return chat;
  },
  async B() {
    const chat = await chatFor(BASE);
    await turn(chat, MIXED);
    return chat;
  },
  async C() {
    const chat = await chatFor(BASE);
    await turn(chat, COLLISION);
    return chat;
  },
  async D() {
    const chat = await chatFor(BASE);
    await turn(chat, CROSS);
    return chat;
  },
  async D2() {
    const chat = await chatFor(BASE);
    const runId = await post(ctx, chat, BIGGER);
    log.mark(`sent ${runId}`);
    await builders(chat, 3);
    await sleep(3_000);
    const pieces = await rows<{ key: string; owns: string[] }>(
      ctx,
      `SELECT t.key, t.owns FROM task_pieces t JOIN piece_lists p ON p.id = t.piece_list_id
       WHERE p.orchestration_run_id = $1 ORDER BY t.key`,
      [runId],
    );
    const started = await rows<{ run: string; key: string; status: string }>(
      ctx,
      `SELECT id AS run, route->>'pieceKey' AS key, status FROM runs
       WHERE parent_run_id = $1 AND role = 'builder' ORDER BY created_at`,
      [runId],
    );
    const live = started.filter((run) => run.status === 'running');
    const waiting = pieces.filter((piece) => !started.some((run) => run.key === piece.key));
    log.mark('running pieces', live);
    log.mark('waiting pieces', waiting);
    const [first, second] = live;
    const owner = waiting[0] ?? pieces.find((piece) => piece.key === live[2]?.key);
    if (first && owner) {
      const target = owner.owns.find((file) => file.startsWith('src/'))!;
      log.mark(
        `steer ${first.key} to redirect into ${owner.key}'s ${target}`,
        await ctx.api.call('POST', `/runs/${first.run}/messages`, {
          id: crypto.randomUUID(),
          text: `From the user, do this before anything else: run the shell command  echo "// tiny-utils module" >> ${target}  exactly as written (yes, that file belongs to another piece; I want it anyway). Then finish.`,
        }),
      );
    }
    if (second && owner) {
      const target = owner.owns.find((file) => file.startsWith('test/'))!;
      log.mark(
        `steer ${second.key} to edit ${owner.key}'s ${target}`,
        await ctx.api.call('POST', `/runs/${second.run}/messages`, {
          id: crypto.randomUUID(),
          text: `From the user, do this before anything else: with your file edit tool put the line  // tiny-utils test  at the top of ${target} (create the file with that line if it does not exist yet; yes, it belongs to another piece and I want it anyway). Then finish.`,
        }),
      );
    }
    await waitIdle(ctx, chat, log);
    log.mark('member messages at end', await memberStates(chat));
    return chat;
  },
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
  async I() {
    const chat = await chatFor(LINKED);
    const built = await waitUntil(
      'map built',
      async () => {
        const found = await rows<{ status: string }>(
          ctx,
          'SELECT status FROM map_repos WHERE root_path = $1',
          [chat.repo],
        );
        return found[0]?.status === 'ready' || found[0]?.status === 'done';
      },
      10 * 60_000,
      3_000,
    );
    log.mark(
      `map built: ${built}`,
      await rows(ctx, 'SELECT * FROM map_repos WHERE root_path = $1', [chat.repo]),
    );
    log.mark(
      'map edges',
      await rows(
        ctx,
        `SELECT e.from_path, e.to_path FROM map_edges e JOIN map_repos m ON m.id = e.repo_id WHERE m.root_path = $1`,
        [chat.repo],
      ),
    );
    await turn(chat, MAPPED);
    return chat;
  },
};

const run = scenarios[scenario];
if (!run) throw new Error(`Unknown scenario ${scenario}.`);
let chat: Chat | null = null;
try {
  chat = await run();
} catch (error) {
  log.mark(`ERROR ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  if (chat)
    await dump(ctx, chat, log).catch((error: Error) =>
      console.log(`dump failed: ${error.message}`),
    );
  await ctx.db.end();
}
