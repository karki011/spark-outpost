import * as acp from '@agentclientprotocol/sdk/unstable';
import { objectFields } from './object-fields.ts';

interface KnownCall {
  name?: string;
  kind?: unknown;
  rawInput?: Record<string, unknown>;
  content?: unknown;
  locations?: unknown;
}

const ENDED = new Set(['completed', 'failed']);
const TOOL_UPDATES = new Set(['tool_call', 'tool_call_update']);

function nameOf(fields: Record<string, unknown>): string | undefined {
  const named = fields.name;
  if (typeof named === 'string' && named.trim()) return named;
  const meta = objectFields(objectFields(fields._meta).claudeCode).toolName;
  return typeof meta === 'string' && meta.trim() ? meta : undefined;
}

function rawInputOf(fields: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = fields.rawInput;
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function learned(known: KnownCall, update: Record<string, unknown>): KnownCall {
  const rawInput = rawInputOf(update);
  const name = nameOf(update);
  return {
    ...known,
    ...(name ? { name } : {}),
    ...(update.kind !== undefined && update.kind !== null ? { kind: update.kind } : {}),
    ...(rawInput ? { rawInput: { ...known.rawInput, ...rawInput } } : {}),
    ...(Array.isArray(update.content) && update.content.length ? { content: update.content } : {}),
    ...(Array.isArray(update.locations) && update.locations.length
      ? { locations: update.locations }
      : {}),
  };
}

function filled(toolCall: Record<string, unknown>, known: KnownCall): Record<string, unknown> {
  const rawInput = rawInputOf(toolCall);
  return {
    ...toolCall,
    ...(nameOf(toolCall) === undefined && known.name ? { name: known.name } : {}),
    ...((toolCall.kind === undefined || toolCall.kind === null) && known.kind !== undefined
      ? { kind: known.kind }
      : {}),
    ...(known.rawInput ? { rawInput: { ...known.rawInput, ...rawInput } } : {}),
    ...(toolCall.content === undefined && known.content !== undefined
      ? { content: known.content }
      : {}),
    ...(toolCall.locations === undefined && known.locations !== undefined
      ? { locations: known.locations }
      : {}),
  };
}

function named(update: Record<string, unknown>, name: string): Record<string, unknown> {
  const meta = objectFields(update._meta);
  const claudeCode = objectFields(meta.claudeCode);
  return { ...update, _meta: { ...meta, claudeCode: { ...claudeCode, toolName: name } } };
}

export function createToolCallMemory(): (message: unknown) => unknown {
  const calls = new Map<string, KnownCall>();
  return (message) => {
    const fields = objectFields(message);
    const params = objectFields(fields.params);
    if (fields.method === acp.methods.client.session.update) {
      const update = objectFields(params.update);
      const id = update.toolCallId;
      if (typeof id !== 'string' || !TOOL_UPDATES.has(String(update.sessionUpdate))) {
        return message;
      }
      const known = learned(calls.get(id) ?? {}, update);
      if (typeof update.status === 'string' && ENDED.has(update.status)) calls.delete(id);
      else calls.set(id, known);
      return nameOf(update) === undefined && known.name
        ? { ...fields, params: { ...params, update: named(update, known.name) } }
        : message;
    }
    if (fields.method !== acp.methods.client.session.requestPermission) return message;
    const toolCall = objectFields(params.toolCall);
    const known = typeof toolCall.toolCallId === 'string' ? calls.get(toolCall.toolCallId) : null;
    if (!known) return message;
    return { ...fields, params: { ...params, toolCall: filled(toolCall, known) } };
  };
}

export function rememberToolCalls(stream: acp.Stream): acp.Stream {
  const remember = createToolCallMemory();
  const readable = stream.readable.pipeThrough(
    new TransformStream<acp.AnyMessage, acp.AnyMessage>({
      transform(message, controller) {
        controller.enqueue(remember(message) as acp.AnyMessage);
      },
    }),
  );
  return { readable, writable: stream.writable };
}
