import type { ProtocolDirection, ProtocolEntryKind } from '@spark-outpost/contracts';
import { mentionsSecretFile, redactValueWithin, redacted, storableText } from './redact.ts';

export const PAYLOAD_CAP_BYTES = 64 * 1024;

export interface ProtocolEntry {
  at: Date;
  direction: ProtocolDirection;
  kind: ProtocolEntryKind;
  method: string | null;
  rpcId: string | null;
  sizeBytes: number;
  truncated: boolean;
  payload: unknown;
}

type Message = Record<string, unknown>;

const READ_FILE_METHOD = 'fs/read_text_file';
const SESSION_UPDATE = 'session/update';

function asRecord(value: unknown): Message | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Message)
    : null;
}

function rpcIdOf(message: Message): string | null {
  const id = message.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
}

function messageKind(message: Message): ProtocolEntryKind {
  if (typeof message.method === 'string') {
    return 'id' in message ? 'request' : 'notification';
  }
  return 'error' in message ? 'error' : 'response';
}

const REDACTION_BUDGET_CHARS = PAYLOAD_CAP_BYTES * 2;

interface CappedPayload {
  payload: unknown;
  truncated: boolean;
}

export function capPayload(payload: unknown): CappedPayload {
  const text = JSON.stringify(payload) ?? 'null';
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= PAYLOAD_CAP_BYTES) return { payload, truncated: false };
  return headOf(bytes);
}

function headOf(bytes: Buffer): CappedPayload {
  let head = storableText(bytes.subarray(0, PAYLOAD_CAP_BYTES).toString('utf8'));
  while (Buffer.byteLength(head, 'utf8') > PAYLOAD_CAP_BYTES) head = head.slice(0, -1);
  return { payload: { head }, truncated: true };
}

function storedPayload(value: unknown): CappedPayload {
  const safe = redactValueWithin(value, REDACTION_BUDGET_CHARS);
  if (!safe.clipped) return capPayload(safe.value);
  return headOf(Buffer.from(JSON.stringify(safe.value) ?? 'null', 'utf8'));
}

function toolUpdate(message: Message): Message | null {
  if (message.method !== SESSION_UPDATE) return null;
  const update = asRecord(asRecord(message.params)?.update);
  const kind = update?.sessionUpdate;
  return kind === 'tool_call' || kind === 'tool_call_update' ? update : null;
}

function withToolOutputRedacted(message: Message): Message {
  const params = asRecord(message.params) ?? {};
  const update = asRecord(params.update) ?? {};
  const scrubbed: Message = { ...update };
  for (const field of ['content', 'rawOutput']) {
    if (field in scrubbed) scrubbed[field] = redacted('secret_file');
  }
  return { ...message, params: { ...params, update: scrubbed } };
}

function withResultContentRedacted(message: Message): Message {
  const result = asRecord(message.result);
  if (!result || !('content' in result)) return message;
  return { ...message, result: { ...result, content: redacted('secret_file') } };
}

const SESSION_OPENERS = new Set(['session/new', 'session/load', 'session/resume']);

function hiddenValues(list: unknown): unknown {
  if (!Array.isArray(list)) return list;
  return list.map((item) => {
    const pair = asRecord(item);
    return pair && 'value' in pair ? { ...pair, value: redacted('mcp_secret') } : item;
  });
}

function withMcpSecretsRedacted(message: Message): Message {
  const params = asRecord(message.params);
  if (!params || !Array.isArray(params.mcpServers)) return message;
  const mcpServers = params.mcpServers.map((server) => {
    const entry = asRecord(server);
    if (!entry) return server;
    return {
      ...entry,
      ...('env' in entry ? { env: hiddenValues(entry.env) } : {}),
      ...('headers' in entry ? { headers: hiddenValues(entry.headers) } : {}),
    };
  });
  return { ...message, params: { ...params, mcpServers } };
}

export interface ProtocolRecorder {
  entry(direction: ProtocolDirection, message: unknown, at?: Date): ProtocolEntry;
}

export function createProtocolRecorder(): ProtocolRecorder {
  const pendingMethods = new Map<string, string>();
  const secretReads = new Set<string>();
  const secretToolCalls = new Set<string>();

  const requestKey = (direction: ProtocolDirection, id: string) => `${direction}:${id}`;
  const replyKey = (direction: ProtocolDirection, id: string) =>
    `${direction === 'to_agent' ? 'from_agent' : 'to_agent'}:${id}`;

  const scrubSecrets = (direction: ProtocolDirection, message: Message, rpcId: string | null) => {
    if (typeof message.method === 'string' && SESSION_OPENERS.has(message.method)) {
      return withMcpSecretsRedacted(message);
    }
    const tool = toolUpdate(message);
    if (tool) {
      const toolCallId = typeof tool.toolCallId === 'string' ? tool.toolCallId : null;
      const secret =
        mentionsSecretFile(tool.rawInput ?? null) || mentionsSecretFile(tool.locations ?? null);
      if (secret && toolCallId) secretToolCalls.add(toolCallId);
      if (secret || (toolCallId && secretToolCalls.has(toolCallId))) {
        return withToolOutputRedacted(message);
      }
      return message;
    }
    if (message.method === READ_FILE_METHOD && rpcId !== null) {
      const path = asRecord(message.params)?.path;
      if (typeof path === 'string' && mentionsSecretFile(path)) {
        secretReads.add(requestKey(direction, rpcId));
      }
      return message;
    }
    if (rpcId !== null && secretReads.delete(replyKey(direction, rpcId))) {
      return withResultContentRedacted(message);
    }
    return message;
  };

  const methodFor = (direction: ProtocolDirection, message: Message, rpcId: string | null) => {
    if (typeof message.method === 'string') {
      if (messageKind(message) === 'request' && rpcId !== null) {
        pendingMethods.set(requestKey(direction, rpcId), message.method);
      }
      return message.method;
    }
    if (rpcId === null) return null;
    const key = replyKey(direction, rpcId);
    const method = pendingMethods.get(key) ?? null;
    pendingMethods.delete(key);
    return method;
  };

  return {
    entry(direction, raw, at = new Date()) {
      const sizeBytes = Buffer.byteLength(JSON.stringify(raw) ?? 'null', 'utf8');
      const message = asRecord(raw);
      if (!message) {
        const capped = storedPayload(raw);
        return {
          at,
          direction,
          kind: 'notification',
          method: null,
          rpcId: null,
          sizeBytes,
          ...capped,
        };
      }
      const rpcId = rpcIdOf(message);
      const method = methodFor(direction, message, rpcId);
      const capped = storedPayload(scrubSecrets(direction, message, rpcId));
      return { at, direction, kind: messageKind(message), method, rpcId, sizeBytes, ...capped };
    },
  };
}
