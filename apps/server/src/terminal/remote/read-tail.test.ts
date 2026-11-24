import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTail } from './read-tail.ts';
import { addTranscriptItems, transcriptItems } from './transcript-items.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'spark-read-tail-'));
  file = path.join(dir, 'session.jsonl');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('reading a transcript tail', () => {
  it('reads only what was added since the last complete line', async () => {
    await writeFile(file, 'one\ntwo\nthr');
    const first = await readTail(file);
    expect(first.lines).toEqual(['one', 'two']);
    expect(first.appended).toBe(false);
    expect(first.offset).toBe(8);

    await appendFile(file, 'ee\nfour\n');
    const next = await readTail(file, first.offset);
    expect(next.lines).toEqual(['three', 'four']);
    expect(next.appended).toBe(true);
    expect(next.truncated).toBe(false);
    expect(next.offset).toBe(next.size);
  });

  it('returns nothing new when the file has not grown', async () => {
    await writeFile(file, 'one\n');
    const first = await readTail(file);
    const again = await readTail(file, first.offset);
    expect(again.lines).toEqual([]);
    expect(again.appended).toBe(true);
    expect(again.offset).toBe(first.offset);
  });

  it('starts over when the file is shorter than where it left off', async () => {
    await writeFile(file, 'one\ntwo\n');
    const first = await readTail(file);
    await writeFile(file, 'new\n');
    const next = await readTail(file, first.offset);
    expect(next.appended).toBe(false);
    expect(next.lines).toEqual(['new']);
  });
});

describe('adding to parsed transcript items', () => {
  const line = (text: string, id: string) =>
    JSON.stringify({
      type: 'assistant',
      uuid: id,
      timestamp: '2026-11-23T10:00:00Z',
      message: { id, content: [{ type: 'text', text }] },
    });

  it('gives the same items in two parts as in one', () => {
    const lines = [line('first', 'a'), line('more of first', 'a'), line('second', 'b')];
    const whole = transcriptItems('claude', lines);
    const parts = addTranscriptItems(
      'claude',
      lines.slice(1),
      transcriptItems('claude', lines.slice(0, 1)),
    );
    expect(parts).toEqual(whole);
  });
});
