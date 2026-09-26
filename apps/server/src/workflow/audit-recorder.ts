import type { ProtocolDirection } from '@spark-outpost/contracts';
import { createProtocolRecorder, type ProtocolEntry } from '../audit/protocol-entry.ts';
import { redactValue } from '../audit/redact.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { ProtocolObserver } from '../providers/provider.ts';

export const STDERR_CAP_BYTES = 1024 * 1024;
const STDERR_PIECE_CHARS = 16_384;

export interface AuditRecorderOptions {
  write(entries: ProtocolEntry[]): Promise<void>;
  batchSize?: number;
  flushMs?: number;
  stderrCapBytes?: number;
  now?: () => Date;
}

export interface AuditRecorder extends ProtocolObserver {
  toolCallCount(): number;
  close(): Promise<void>;
  discard(): void;
}

function isToolCall(direction: ProtocolDirection, message: unknown): boolean {
  if (direction !== 'from_agent' || message === null || typeof message !== 'object') return false;
  const { method, params } = message as { method?: unknown; params?: { update?: unknown } };
  if (method !== 'session/update') return false;
  const update = params?.update as { sessionUpdate?: unknown } | undefined;
  return update?.sessionUpdate === 'tool_call';
}

export function createAuditRecorder(options: AuditRecorderOptions): AuditRecorder {
  const batchSize = options.batchSize ?? 50;
  const flushMs = options.flushMs ?? 250;
  const stderrCap = options.stderrCapBytes ?? STDERR_CAP_BYTES;
  const now = options.now ?? (() => new Date());
  const protocol = createProtocolRecorder();
  let buffer: ProtocolEntry[] = [];
  let chain: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let reportedError = false;
  let toolCalls = 0;
  let stderrPending = '';
  let stderrKept = 0;
  let stderrOmitted = 0;

  const writeBatch = async () => {
    if (stopped || buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    try {
      await options.write(batch);
    } catch (error) {
      if (error instanceof LeaseLostError) {
        stopped = true;
        buffer = [];
        return;
      }
      buffer = [...batch, ...buffer];
      if (!reportedError) console.error('Audit log write failed; will retry', error);
      reportedError = true;
    }
  };

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    chain = chain.then(writeBatch);
    return chain;
  };

  const enqueue = (entry: ProtocolEntry) => {
    buffer.push(entry);
    if (buffer.length >= batchSize) void flush();
    else timer ??= setTimeout(() => void flush(), flushMs);
  };

  const stderrEntry = (text: string) => {
    const payload = { text: redactValue(text) };
    enqueue({
      at: now(),
      direction: 'from_agent',
      kind: 'stderr',
      method: null,
      rpcId: null,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      truncated: false,
      payload,
    });
  };

  const takeStderr = (all: boolean) => {
    const cut = all ? stderrPending.length : stderrPending.lastIndexOf('\n') + 1;
    const forced = cut === 0 && stderrPending.length >= STDERR_PIECE_CHARS;
    const end = forced ? stderrPending.length : cut;
    if (end === 0) return;
    const text = stderrPending.slice(0, end);
    stderrPending = stderrPending.slice(end);
    for (let start = 0; start < text.length; start += STDERR_PIECE_CHARS) {
      stderrEntry(text.slice(start, start + STDERR_PIECE_CHARS));
    }
  };

  return {
    message(direction, message) {
      if (stopped) return;
      if (isToolCall(direction, message)) toolCalls += 1;
      enqueue(protocol.entry(direction, message, now()));
    },
    stderr(chunk) {
      if (stopped) return;
      const bytes = Buffer.byteLength(chunk, 'utf8');
      const room = stderrCap - stderrKept;
      if (room <= 0) {
        stderrOmitted += bytes;
        return;
      }
      const kept = bytes <= room ? chunk : Buffer.from(chunk).subarray(0, room).toString('utf8');
      stderrKept += Math.min(bytes, room);
      stderrOmitted += bytes - Math.min(bytes, room);
      stderrPending += kept;
      takeStderr(false);
    },
    toolCallCount: () => toolCalls,
    async close() {
      if (stopped) return;
      takeStderr(true);
      if (stderrOmitted > 0) {
        enqueue({
          at: now(),
          direction: 'from_agent',
          kind: 'stderr',
          method: null,
          rpcId: null,
          sizeBytes: stderrOmitted,
          truncated: true,
          payload: { omittedBytes: stderrOmitted, capBytes: stderrCap },
        });
      }
      await flush();
      if (buffer.length > 0) await flush();
      stopped = true;
      buffer = [];
    },
    discard() {
      stopped = true;
      buffer = [];
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
