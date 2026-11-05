import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { VoiceModelFile } from '@spark-outpost/contracts';

export type FetchModel = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

export class ModelDidNotCheckOut extends Error {}

export const modelPath = (dir: string, model: VoiceModelFile) => path.join(dir, model.file);

export async function modelPresent(dir: string, model: VoiceModelFile): Promise<boolean> {
  const info = await stat(modelPath(dir, model)).catch(() => null);
  return info?.isFile() === true && info.size === model.size;
}

async function write(
  file: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  const hash = createHash('sha256');
  const out = createWriteStream(file);
  let bytes = 0;
  try {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
      signal.throwIfAborted();
      hash.update(chunk);
      bytes += chunk.byteLength;
      progress(bytes);
      if (!out.write(chunk))
        await new Promise<void>((resolve) => out.once('drain', () => resolve()));
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      out.end((error?: Error | null) => (error ? reject(error) : resolve())),
    );
  }
  return { bytes, sha256: hash.digest('hex') };
}

export async function downloadModel(options: {
  dir: string;
  model: VoiceModelFile;
  fetch: FetchModel;
  signal?: AbortSignal;
  progress(fraction: number): void;
}): Promise<string> {
  const { dir, model } = options;
  await mkdir(dir, { recursive: true });
  const partial = path.join(dir, `${model.sha256}.partial`);
  const target = modelPath(dir, model);
  await rm(partial, { force: true });
  try {
    const signal = options.signal ?? new AbortController().signal;
    const response = await options.fetch(model.url, { signal });
    if (!response.ok || !response.body)
      throw new ModelDidNotCheckOut(`The download failed (${response.status}).`);
    const got = await write(partial, response.body, signal, (bytes) =>
      options.progress(Math.min(1, bytes / model.size)),
    );
    signal.throwIfAborted();
    if (got.bytes !== model.size || got.sha256 !== model.sha256)
      throw new ModelDidNotCheckOut('The download didn’t check out.');
    await rename(partial, target);
    return target;
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

export async function removeModel(dir: string, model: VoiceModelFile): Promise<void> {
  await rm(path.join(dir, `${model.sha256}.partial`), { force: true });
  await rm(modelPath(dir, model), { force: true });
}
