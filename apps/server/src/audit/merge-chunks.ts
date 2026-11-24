import { PAYLOAD_CAP_BYTES, type ProtocolEntry } from './protocol-entry.ts';

export const MERGED_CHUNK_MAX_BYTES = PAYLOAD_CAP_BYTES / 4;

const TEXT_CHUNKS = new Set(['agent_message_chunk', 'agent_thought_chunk']);

type Fields = Record<string, unknown>;

interface ChunkParts {
  payload: Fields;
  params: Fields;
  update: Fields;
  content: Fields;
  text: string;
}

export interface TextChunk {
  key: string;
  text: string;
}

function fieldsOf(value: unknown): Fields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Fields)
    : null;
}

function isPlainChunkEntry(entry: ProtocolEntry): boolean {
  if (entry.direction !== 'from_agent' || entry.kind !== 'notification') return false;
  return entry.method === 'session/update' && !entry.truncated && entry.unreviewed !== true;
}

function chunkParts(entry: ProtocolEntry): ChunkParts | null {
  if (!isPlainChunkEntry(entry)) return null;
  const payload = fieldsOf(entry.payload);
  const params = fieldsOf(payload?.params);
  const update = fieldsOf(params?.update);
  const content = fieldsOf(update?.content);
  if (!payload || !params || !update || !content) return null;
  if (typeof update.sessionUpdate !== 'string' || !TEXT_CHUNKS.has(update.sessionUpdate)) {
    return null;
  }
  if (content.type !== 'text' || typeof content.text !== 'string') return null;
  return { payload, params, update, content, text: content.text };
}

function withText(parts: ChunkParts, text: string): Fields {
  const update = { ...parts.update, content: { ...parts.content, text } };
  return { ...parts.payload, params: { ...parts.params, update } };
}

export function textChunk(entry: ProtocolEntry): TextChunk | null {
  const parts = chunkParts(entry);
  return parts ? { key: JSON.stringify(withText(parts, '')), text: parts.text } : null;
}

export function fitsOneEntry(first: ProtocolEntry, next: ProtocolEntry): boolean {
  return first.sizeBytes + next.sizeBytes <= MERGED_CHUNK_MAX_BYTES;
}

export function withChunkAdded(first: ProtocolEntry, next: ProtocolEntry): ProtocolEntry {
  const parts = chunkParts(first);
  const added = chunkParts(next);
  if (!parts || !added) throw new Error('Only text chunks can be merged.');
  return {
    ...first,
    sizeBytes: first.sizeBytes + next.sizeBytes,
    payload: withText(parts, parts.text + added.text),
  };
}
