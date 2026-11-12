import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { VoiceModelFile } from '@spark-outpost/contracts';
import { downloadModel, modelPresent } from './model.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const body = Buffer.from('pretend weights '.repeat(4096));
const model: VoiceModelFile = {
  file: 'ggml-test.bin',
  url: 'https://example.invalid/ggml-test.bin',
  sha256: createHash('sha256').update(body).digest('hex'),
  size: body.length,
};

async function folder() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'voice-model-'));
  dirs.push(dir);
  return dir;
}

describe('downloadModel', () => {
  it('streams to a .partial file, checks it and renames it into place', async () => {
    const dir = await folder();
    const progress: number[] = [];
    const file = await downloadModel({
      dir,
      model,
      fetch: async () => new Response(body),
      progress: (fraction) => progress.push(fraction),
    });
    expect(await readFile(file)).toEqual(body);
    expect(await readdir(dir)).toEqual(['ggml-test.bin']);
    expect(progress.at(-1)).toBe(1);
    expect(await modelPresent(dir, model)).toBe(true);
  });

  it('deletes a download with the wrong hash and says it didn’t check out', async () => {
    const dir = await folder();
    const tampered = Buffer.from(body);
    tampered[10] = 0;
    await expect(
      downloadModel({
        dir,
        model,
        fetch: async () => new Response(tampered),
        progress: () => undefined,
      }),
    ).rejects.toThrow('The download didn’t check out.');
    expect(await readdir(dir)).toEqual([]);
  });

  it('deletes a short download', async () => {
    const dir = await folder();
    await expect(
      downloadModel({
        dir,
        model,
        fetch: async () => new Response(body.subarray(0, 100)),
        progress: () => undefined,
      }),
    ).rejects.toThrow('The download didn’t check out.');
    expect(await readdir(dir)).toEqual([]);
    expect(await modelPresent(dir, model)).toBe(false);
  });

  it('a cancelled download deletes its .partial file', async () => {
    const dir = await folder();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      pull(source) {
        source.enqueue(body.subarray(0, 100));
        controller.abort();
      },
    });
    await expect(
      downloadModel({
        dir,
        model,
        fetch: async () => new Response(stream),
        signal: controller.signal,
        progress: () => undefined,
      }),
    ).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
