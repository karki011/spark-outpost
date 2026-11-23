import { randomBytes } from 'node:crypto';
import type { Keyring } from './keychain.ts';

export const CHUNK_LIMIT = 1000;
const MARKER = 'spark-chunks:v1:';

const MARKED = /^spark-chunks:v1:([0-9a-f]{8}):([1-9]\d*)$/;

interface Parts {
  generation: string;
  count: number;
}

function chunkAccount(account: string, generation: string, index: number): string {
  return `${account}#${generation}-${index}`;
}

function partsOf(head: string | null): Parts | null {
  const marked = head === null ? null : MARKED.exec(head);
  return marked ? { generation: marked[1]!, count: Number(marked[2]) } : null;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function splitSecret(secret: string, limit: number = CHUNK_LIMIT): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < secret.length) {
    let end = Math.min(start + limit, secret.length);
    if (end < secret.length && isHighSurrogate(secret.charCodeAt(end - 1))) end -= 1;
    parts.push(secret.slice(start, end));
    start = end;
  }
  return parts;
}

async function deleteParts(inner: Keyring, account: string, parts: Parts | null) {
  if (!parts) return;
  for (let index = 1; index <= parts.count; index += 1) {
    const part = chunkAccount(account, parts.generation, index);
    if ((await inner.get(part)) !== null) await inner.delete(part);
  }
}

async function dropParts(inner: Keyring, account: string, parts: Parts | null) {
  await deleteParts(inner, account, parts).catch(() => undefined);
}

const randomGeneration = () => randomBytes(4).toString('hex');

function freshGeneration(before: Parts | null, generate: () => string): string {
  let generation = generate();
  while (generation === before?.generation) generation = generate();
  return generation;
}

export function chunkedKeyring(
  inner: Keyring,
  limit: number = CHUNK_LIMIT,
  generate: () => string = randomGeneration,
): Keyring {
  return {
    async get(account) {
      const head = await inner.get(account);
      const parts = partsOf(head);
      if (!parts) return head;
      const pieces: string[] = [];
      for (let index = 1; index <= parts.count; index += 1) {
        const piece = await inner.get(chunkAccount(account, parts.generation, index));
        if (piece === null) {
          throw new Error(`Part ${index} of ${parts.count} of a saved secret is missing`);
        }
        pieces.push(piece);
      }
      return pieces.join('');
    },
    async set(account, secret) {
      const before = partsOf(await inner.get(account));
      if (secret.length <= limit && !secret.startsWith(MARKER)) {
        await inner.set(account, secret);
        await dropParts(inner, account, before);
        return;
      }
      const pieces = splitSecret(secret, limit);
      const next: Parts = { generation: freshGeneration(before, generate), count: pieces.length };
      try {
        for (const [index, piece] of pieces.entries()) {
          await inner.set(chunkAccount(account, next.generation, index + 1), piece);
        }
      } catch (error) {
        await dropParts(inner, account, next);
        throw error;
      }
      await inner.set(account, `${MARKER}${next.generation}:${next.count}`);
      await dropParts(inner, account, before);
    },
    async delete(account) {
      await deleteParts(inner, account, partsOf(await inner.get(account)));
      await inner.delete(account);
    },
  };
}
