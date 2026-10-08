import { BASE, LINKED } from './fixtures.ts';
import { BIGGER, COLLISION, CROSS, FOUR, MAPPED, MIXED, TWO } from './prompts.ts';
import { post, rows, sleep, waitIdle, waitUntil } from './lib.ts';
import { builders, chatFor, ctx, log, memberStates, turn, type Scenarios } from './scn-kit.ts';

export const pieceScenarios: Scenarios = {
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
  async D3() {
    const chat = await chatFor(BASE);
    const runId = await post(ctx, chat, TWO);
    log.mark(`sent ${runId}`);
    await builders(chat, 2);
    await sleep(2_000);
    const started = await rows<{ run: string; key: string; status: string; owns: string[] }>(
      ctx,
      `SELECT r.id AS run, r.route->>'pieceKey' AS key, r.status, t.owns FROM runs r
       JOIN piece_lists p ON p.orchestration_run_id = r.parent_run_id
       JOIN task_pieces t ON t.piece_list_id = p.id AND t.key = r.route->>'pieceKey'
       WHERE r.parent_run_id = $1 AND r.role = 'builder' ORDER BY r.created_at`,
      [runId],
    );
    log.mark('running pieces', started);
    const [first, second] = started;
    if (first && second) {
      const source = second.owns.find((file) => file.startsWith('src/'))!;
      const test = first.owns.find((file) => file.startsWith('test/'))!;
      log.mark(
        `steer ${first.key} to edit ${second.key}'s ${source}`,
        await ctx.api.call('POST', `/runs/${first.run}/messages`, {
          id: crypto.randomUUID(),
          text: `A change to the plan from me, the user: the header comment in ${source} is now part of your piece as well. With your Write or Edit tool, make the first line of ${source} read  // tiny-utils module  (create the file with that line if it is not there yet; keep whatever else is in it). The other Builder knows and will keep the line. Do that first, then carry on with your own files.`,
        }),
      );
      log.mark(
        `steer ${second.key} to redirect into ${first.key}'s ${test}`,
        await ctx.api.call('POST', `/runs/${second.run}/messages`, {
          id: crypto.randomUUID(),
          text: `A change to the plan from me, the user: the trailer comment of ${test} is now part of your piece as well. Run the shell command  echo "// tiny-utils test" >> ${test}  now. The other Builder knows and will keep the line. Do that first, then carry on with your own files.`,
        }),
      );
    }
    await waitIdle(ctx, chat, log);
    log.mark('member messages at end', await memberStates(chat));
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
