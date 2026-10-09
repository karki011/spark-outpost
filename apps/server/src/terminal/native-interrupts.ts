import { statSync, unwatchFile, watchFile } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isRecord } from '../agent-config/records.ts';

const INTERRUPT_PREFIX = '[Request interrupted by user';
const INTERRUPT_TEXTS = [
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
];
const NEWLINE = 0x0a;
const POLL_MS = 200;

export interface InterruptWatcher {
  ready: Promise<void>;
  close(): void;
}

export type WatchInterrupts = (
  path: string,
  onInterrupt: (nativeTurnId: string) => Promise<void>,
) => InterruptWatcher | null;

function interruptedTurn(line: string): string | null {
  if (!line.includes(INTERRUPT_PREFIX)) return null;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(record) || record.type !== 'user' || record.isSidechain === true) return null;
  if (typeof record.promptId !== 'string' || !isRecord(record.message)) return null;
  const content = record.message.content;
  if (!Array.isArray(content) || content.length !== 1) return null;
  const block: unknown = content[0];
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return null;
  return INTERRUPT_TEXTS.includes(block.text) ? record.promptId : null;
}

export function interruptedTurns(data: Buffer): { turns: string[]; rest: Buffer } {
  const end = data.lastIndexOf(NEWLINE);
  if (end < 0) return { turns: [], rest: data };
  const turns = data
    .subarray(0, end)
    .toString('utf8')
    .split('\n')
    .map(interruptedTurn)
    .filter((turn): turn is string => turn !== null);
  return { turns, rest: data.subarray(end + 1) };
}

export const watchClaudeInterrupts: WatchInterrupts = (path, onInterrupt) => {
  let offset: number | null = null;
  let rest: Buffer = Buffer.alloc(0);
  let closed = false;
  const read = async () => {
    const file = await open(path, 'r').catch(() => null);
    if (!file) {
      offset ??= 0;
      return;
    }
    try {
      const { size } = await file.stat();
      if (offset === null || size < offset) {
        offset = size;
        rest = Buffer.alloc(0);
        return;
      }
      if (size === offset) return;
      const added = Buffer.alloc(size - offset);
      const { bytesRead } = await file.read(added, 0, added.length, offset);
      offset += bytesRead;
      const parsed = interruptedTurns(Buffer.concat([rest, added.subarray(0, bytesRead)]));
      rest = parsed.rest;
      for (const turn of parsed.turns) if (!closed) void onInterrupt(turn);
    } finally {
      await file.close();
    }
  };
  let chain = Promise.resolve();
  const queue = () => {
    chain = chain.then(() => (closed ? undefined : read())).catch(() => undefined);
    return chain;
  };
  try {
    if (!statSync(dirname(path)).isDirectory()) return null;
  } catch {
    return null;
  }
  const onChange = () => void queue();
  watchFile(path, { interval: POLL_MS, persistent: false }, onChange);
  const ready = queue();
  return {
    ready,
    close() {
      closed = true;
      unwatchFile(path, onChange);
    },
  };
};
