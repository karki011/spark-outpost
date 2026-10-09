import { appendFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { interruptedTurns, watchClaudeInterrupts } from './native-interrupts.ts';

const interrupt = (promptId: string, text = '[Request interrupted by user]') =>
  `${JSON.stringify({
    type: 'user',
    isSidechain: false,
    promptId,
    message: { role: 'user', content: [{ type: 'text', text }] },
  })}\n`;

describe('Claude interrupt records', () => {
  it('reads the turn of an interrupt record and of an interrupted tool use', () => {
    const lines = Buffer.from(
      interrupt('first') + interrupt('second', '[Request interrupted by user for tool use]'),
    );
    expect(interruptedTurns(lines)).toEqual({ turns: ['first', 'second'], rest: Buffer.alloc(0) });
  });

  it('ignores a prompt the user typed, other records, sidechains and text that is not JSON', () => {
    const typed = JSON.stringify({
      type: 'user',
      promptId: 'typed',
      message: { role: 'user', content: '[Request interrupted by user]' },
    });
    const quoted = JSON.stringify({
      type: 'user',
      promptId: 'quoted',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '[Request interrupted by user]' },
          { type: 'text', text: 'more' },
        ],
      },
    });
    const assistant = JSON.stringify({
      type: 'assistant',
      promptId: 'assistant',
      message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] },
    });
    const sidechain = interrupt('sidechain').replace('"isSidechain":false', '"isSidechain":true');
    const untitled = interrupt('x').replace('"promptId":"x",', '');
    const lines = [typed, quoted, assistant, '{[Request interrupted by user]', 'null', ''].join(
      '\n',
    );
    expect(interruptedTurns(Buffer.from(`${lines}\n${sidechain}${untitled}`)).turns).toEqual([]);
  });

  it('keeps an unfinished line until the rest of it arrives', () => {
    const record = Buffer.from(interrupt('split'));
    const first = interruptedTurns(record.subarray(0, 40));
    expect(first.turns).toEqual([]);
    expect(interruptedTurns(Buffer.concat([first.rest, record.subarray(40)])).turns).toEqual([
      'split',
    ]);
  });
});

describe('Claude interrupt watcher', () => {
  let folder: string;
  let path: string;
  beforeEach(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-native-interrupts-')));
    path = join(folder, 'native-provider-session.jsonl');
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('reports only records appended after it started watching', async () => {
    await writeFile(path, interrupt('earlier-turn'));
    const seen = vi.fn(async (_turn: string) => undefined);
    const watcher = watchClaudeInterrupts(path, seen)!;
    await watcher.ready;
    await appendFile(path, `{"type":"assistant"}\n${interrupt('current-turn')}`);
    await expect.poll(() => seen.mock.calls).toEqual([['current-turn']]);
    watcher.close();
  });

  it('follows a transcript that is created after the turn started', async () => {
    const seen = vi.fn(async (_turn: string) => undefined);
    const watcher = watchClaudeInterrupts(path, seen)!;
    await watcher.ready;
    await writeFile(path, interrupt('first-turn'));
    await expect.poll(() => seen.mock.calls).toEqual([['first-turn']]);
    watcher.close();
  });

  it('stops reporting once closed and reports nothing for a folder that does not exist', async () => {
    const seen = vi.fn(async (_turn: string) => undefined);
    const watcher = watchClaudeInterrupts(path, seen)!;
    await watcher.ready;
    watcher.close();
    await appendFile(path, interrupt('after-close'));
    const later = watchClaudeInterrupts(path, seen)!;
    await later.ready;
    await appendFile(path, interrupt('marker'));
    await expect.poll(() => seen.mock.calls).toEqual([['marker']]);
    later.close();
    expect(watchClaudeInterrupts(join(folder, 'missing', 'a.jsonl'), seen)).toBeNull();
  });
});
