import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeTerminalRow } from '../src/persistence/native-terminals.ts';
import { fixtureLines } from './fixtures/terminal-usage/read.ts';
import { nativeRuntimeFixture, type NativeRuntimeFixture } from './native-terminal-fixture.ts';

let f: NativeRuntimeFixture;
beforeEach(async () => {
  f = await nativeRuntimeFixture();
});
afterEach(async () => {
  await f?.cleanup();
});

const SESSION = '9b27f12b-a551-490a-8dbe-06eac459a6a7';
const AGENT = 'a3cccaf159c23381c';
const FIRST = '5d960b67';
const SUBAGENT = 'a57adc62';
const NOTICE = 'a973dbb2';
const TYPED = '84959583';
const HANDBACK = '0dca7edf';
const transcript_path = join('/fixture/projects', `${SESSION}.jsonl`);
const parsed = (name: string) => fixtureLines(name).map((line) => JSON.parse(line) as unknown);
const main = parsed('claude-pass2-typed-during-subagent.jsonl');
const side = parsed('claude-pass2-subagent.jsonl');
const promptIds = new Map(
  (main as { promptId?: string }[]).flatMap((record) =>
    record.promptId ? [[record.promptId.slice(0, 8), record.promptId] as const] : [],
  ),
);
const id = (short: string) => promptIds.get(short)!;
const hook = (name: string, prompt: string, extra: Record<string, unknown> = {}) =>
  f.hook(name, { session_id: SESSION, transcript_path, prompt_id: id(prompt), ...extra });
const reader = () => f.watchers.findLast((watcher) => watcher.path === transcript_path)!;
const usage = () => f.runtime.usage(f.conversationId);
const state = async () => (await nativeTerminalRow(f.t.db, f.conversationId))!.state;
const settled = () => f.runtime.usage(f.conversationId);

describe('replay of a real session: a prompt typed while a sub-agent runs', () => {
  it('lists only the prompts the user typed and files every reply once, under its own prompt', async () => {
    await f.launch();
    await hook('UserPromptSubmit', FIRST, { prompt: 'x' });
    reader().atFlush.push(...main.slice(0, 34));
    await hook('Stop', FIRST);

    await hook('UserPromptSubmit', SUBAGENT, { prompt: 'x' });
    await reader().lines(main.slice(34, 40));
    reader().atFlush.push(...main.slice(40, 44));
    await hook('Stop', SUBAGENT);
    const child = { tool_name: 'Bash', tool_use_id: 'toolu_child_1', agent_id: AGENT };
    await hook('PreToolUse', SUBAGENT, child);
    await hook('PostToolUse', SUBAGENT, child);
    const sideFile = f.watchers.at(-1)!;
    await sideFile.lines(side.slice(0, 24));

    await hook('UserPromptSubmit', NOTICE, { prompt: 'task notification text' });
    expect((await usage()).turns).toHaveLength(3);
    await reader().lines(main.slice(44, 47));
    await settled();
    expect((await usage()).turns).toHaveLength(2);
    expect(await state()).toBe('working');
    await hook('Stop', NOTICE);
    expect(await state()).toBe('ready');

    await hook('UserPromptSubmit', TYPED, { prompt: 'x' });
    reader().atFlush.push(...main.slice(47, 55));
    await hook('Stop', TYPED);
    expect((await usage()).turns.map((turn) => turn.tokens?.output ?? null)).toEqual([5, 459, 5]);

    await sideFile.lines(side.slice(24));
    await hook('UserPromptSubmit', HANDBACK, { prompt: 'agent message text' });
    await reader().lines(main.slice(55, 66));
    await hook('Stop', HANDBACK);
    f.exits[0]!({ exitCode: 0 });
    await expect.poll(state).toBe('exited');
    await f.watchers.at(-1)!.lines(main.slice(66));

    await expect
      .poll(async () => (await usage()).reported.map((total) => total.costUsd))
      .toEqual([0.542807]);
    const seen = await usage();
    expect(seen.turns.map((turn) => [turn.status, turn.tokens?.output, turn.steps.length])).toEqual(
      [
        ['succeeded', 5, 0],
        ['succeeded', 258 + 42 + 81 + 63 + 16 + 17 + 2 + 43 + 16 + 25, 1],
        ['succeeded', 5, 0],
      ],
    );
    expect(seen.turns[2]!.tokens).toMatchObject({ input: 2, cachedRead: 43646, cachedWrite: 85 });
    const stored = await f.t.db.query<{ runs: number; messages: number }>(
      `SELECT (SELECT count(*)::int FROM runs WHERE conversation_id = $1) AS runs,
         (SELECT count(*)::int FROM messages WHERE conversation_id = $1 AND role = 'user') AS messages`,
      [f.conversationId],
    );
    expect(stored.rows[0]).toEqual({ runs: 3, messages: 3 });
  });

  it('keeps a prompt as a normal turn when the file never shows who sent it', async () => {
    await f.launch();
    await hook('UserPromptSubmit', FIRST, { prompt: 'x' });
    await hook('Stop', FIRST);
    await hook('UserPromptSubmit', HANDBACK, { prompt: 'x' });
    await hook('Stop', HANDBACK);
    expect((await usage()).turns.map((turn) => turn.status)).toEqual(['succeeded', 'succeeded']);
  });
});
