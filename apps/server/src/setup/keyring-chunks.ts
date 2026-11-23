import type { Keyring } from './keychain.ts';

export const CHUNK_LIMIT = 1000;
const MARKER = 'spark-chunks:v1:';

function chunkAccount(account: string, index: number): string {
  return `${account}#chunk-${index}`;
}

function chunkCount(head: string | null): number {
  if (head === null || !head.startsWith(MARKER)) return 0;
  const count = Number(head.slice(MARKER.length));
  return Number.isInteger(count) && count > 0 ? count : 0;
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

async function deleteChunks(inner: Keyring, account: string, from: number, to: number) {
  for (let index = from; index <= to; index += 1) {
    await inner.delete(chunkAccount(account, index)).catch(() => undefined);
  }
}

export function chunkedKeyring(inner: Keyring, limit: number = CHUNK_LIMIT): Keyring {
  return {
    async get(account) {
      const head = await inner.get(account);
      const count = chunkCount(head);
      if (count === 0) return head;
      const parts: string[] = [];
      for (let index = 1; index <= count; index += 1) {
        const part = await inner.get(chunkAccount(account, index));
        if (part === null)
          throw new Error(`Part ${index} of ${count} of a saved secret is missing`);
        parts.push(part);
      }
      return parts.join('');
    },
    async set(account, secret) {
      const before = chunkCount(await inner.get(account));
      const fits = secret.length <= limit && !secret.startsWith(MARKER);
      const parts = fits ? [] : splitSecret(secret, limit);
      for (const [index, part] of parts.entries()) {
        await inner.set(chunkAccount(account, index + 1), part);
      }
      await inner.set(account, fits ? secret : `${MARKER}${parts.length}`);
      await deleteChunks(inner, account, parts.length + 1, before);
    },
    async delete(account) {
      const count = chunkCount(await inner.get(account).catch(() => null));
      await inner.delete(account);
      await deleteChunks(inner, account, 1, count);
    },
  };
}
