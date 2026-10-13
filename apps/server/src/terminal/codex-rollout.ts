import { isRecord } from '../agent-config/records.ts';
import {
  parseLine,
  tokenCount,
  type TranscriptParser,
  type TranscriptRecord,
} from './native-transcript.ts';

function turnUsage(
  payload: Record<string, unknown>,
  models: ReadonlyMap<string, string>,
): TranscriptRecord[] {
  const { turn_id: turnId, thread_id: threadId, turn_token_usage: usage } = payload;
  if (typeof turnId !== 'string' || typeof threadId !== 'string' || !isRecord(usage)) return [];
  return [
    {
      kind: 'response',
      turnId: typeof payload.root_turn_id === 'string' ? payload.root_turn_id : turnId,
      responseId: `${threadId}:${turnId}`,
      model: models.get(turnId) ?? null,
      tokens: {
        input: tokenCount(usage.input_tokens),
        output: tokenCount(usage.output_tokens),
        cachedRead: tokenCount(usage.cached_input_tokens),
        cachedWrite: tokenCount(usage.cache_write_input_tokens),
        cachedWriteLong: 0,
        thought: tokenCount(usage.reasoning_output_tokens),
      },
    },
  ];
}

export function codexRolloutParser(): TranscriptParser {
  const models = new Map<string, string>();
  return {
    push(line) {
      const record = parseLine(line);
      if (!isRecord(record) || !isRecord(record.payload)) return [];
      const payload = record.payload;
      if (record.type === 'token_usage_record') return turnUsage(payload, models);
      if (
        record.type === 'turn_context' &&
        typeof payload.turn_id === 'string' &&
        typeof payload.model === 'string'
      )
        models.set(payload.turn_id, payload.model);
      return [];
    },
  };
}
