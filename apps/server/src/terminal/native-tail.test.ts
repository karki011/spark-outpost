import { appendFile, mkdtemp, realpath, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeLines, watchTranscript } from './native-tail.ts';

describe('complete lines', () => {
  it('keeps an unfinished last line until the rest of it arrives', () => {
    const first = completeLines(Buffer.from('{"a":1}\n\n{"b":'));
    expect(first.lines).toEqual(['{"a":1}']);
    expect(completeLines(Buffer.concat([first.rest, Buffer.from('2}\n')])).lines).toEqual([
      '{"b":2}',
    ]);
  });
});

describe('transcript watcher', () => {
  let folder: string;
  let path: string;
  let seen: string[];
  const collect = async (lines: string[]) => {
    seen.push(...lines);
  };
  beforeEach(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'spark-native-tail-')));
    path = join(folder, 'native-provider-session.jsonl');
    seen = [];
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('reports only lines appended after it started watching', async () => {
    await writeFile(path, 'earlier\n');
    const watcher = watchTranscript(path, null, collect)!;
    await watcher.ready;
    expect(watcher.offset()).toBe(8);
    await appendFile(path, 'first\nsecond\n');
    await expect.poll(() => seen).toEqual(['first', 'second']);
    watcher.close();
  });

  it('follows a file that is created after watching began', async () => {
    const watcher = watchTranscript(path, null, collect)!;
    await watcher.ready;
    await writeFile(path, 'created\n');
    await expect.poll(() => seen).toEqual(['created']);
    watcher.close();
  });

  it('continues from a given position without replaying what came before it', async () => {
    await writeFile(path, 'one\ntwo\nthr');
    const first = watchTranscript(path, 4, collect)!;
    await first.flush();
    expect(seen).toEqual(['two']);
    expect(first.offset()).toBe(8);
    first.close();
    await appendFile(path, 'ee\n');
    const second = watchTranscript(path, first.offset(), collect)!;
    await second.ready;
    expect(seen).toEqual(['two', 'three']);
    second.close();
  });

  it('skips to the new end when the file was truncated or replaced', async () => {
    await writeFile(path, 'a long line that was there before\n');
    const watcher = watchTranscript(path, null, collect)!;
    await watcher.ready;
    await truncate(path, 0);
    await appendFile(path, 'rewritten\n');
    await watcher.flush();
    expect(seen).toEqual([]);
    await appendFile(path, 'after\n');
    await watcher.flush();
    expect(seen).toEqual(['after']);
    watcher.close();
  });

  it('stops reporting once closed and reports nothing for a folder that does not exist', async () => {
    const watcher = watchTranscript(path, null, collect)!;
    await watcher.ready;
    watcher.close();
    await appendFile(path, 'after-close\n');
    await watcher.flush();
    expect(seen).toEqual([]);
    expect(watchTranscript(join(folder, 'missing', 'a.jsonl'), null, collect)).toBeNull();
  });

  it('keeps reading when a handler fails', async () => {
    let calls = 0;
    const watcher = watchTranscript(path, null, async () => {
      calls += 1;
      throw new Error('handler failed');
    })!;
    await watcher.ready;
    await appendFile(path, 'one\n');
    await watcher.flush();
    await appendFile(path, 'two\n');
    await watcher.flush();
    expect(calls).toBe(2);
    watcher.close();
  });
});
