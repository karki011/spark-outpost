import { isRecord } from '../agent-config/records.ts';
import {
  parseLine,
  tokenCount,
  type ReportedModel,
  type TranscriptParser,
  type TranscriptRecord,
} from './native-transcript.ts';

const INTERRUPT_TEXTS = [
  '[Request interrupted by user]',
  '[Request interrupted by user for tool use]',
];

function interruptText(message: Record<string, unknown>): boolean {
  const content = message.content;
  if (!Array.isArray(content) || content.length !== 1) return false;
  const block: unknown = content[0];
  return (
    isRecord(block) &&
    block.type === 'text' &&
    typeof block.text === 'string' &&
    INTERRUPT_TEXTS.includes(block.text)
  );
}

function response(record: Record<string, unknown>, turnId: string | null): TranscriptRecord[] {
  const message = record.message;
  if (!isRecord(message) || typeof message.id !== 'string' || !isRecord(message.usage)) return [];
  const usage = message.usage;
  const written = isRecord(usage.cache_creation) ? usage.cache_creation : {};
  const details = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : {};
  return [
    {
      kind: 'response',
      turnId,
      responseId: message.id,
      model: typeof message.model === 'string' ? message.model : null,
      tokens: {
        input: tokenCount(usage.input_tokens),
        output: tokenCount(usage.output_tokens),
        cachedRead: tokenCount(usage.cache_read_input_tokens),
        cachedWrite: tokenCount(usage.cache_creation_input_tokens),
        cachedWriteLong: tokenCount(written.ephemeral_1h_input_tokens),
        thought: tokenCount(details.thinking_tokens),
      },
    },
  ];
}

function reportedModels(usage: unknown): ReportedModel[] {
  if (!isRecord(usage)) return [];
  return Object.entries(usage).flatMap(([model, counts]) =>
    isRecord(counts)
      ? [
          {
            model,
            input: tokenCount(counts.inputTokens),
            output: tokenCount(counts.outputTokens),
            cachedRead: tokenCount(counts.cacheReadInputTokens),
            cachedWrite: tokenCount(counts.cacheCreationInputTokens),
            thought: tokenCount(counts.thinkingTokens),
            costUsd:
              typeof counts.costUSD === 'number' && counts.costUSD >= 0 ? counts.costUSD : null,
          },
        ]
      : [],
  );
}

function reported(record: Record<string, unknown>): TranscriptRecord[] {
  const { sessionId, totalCostUSD: costUsd } = record;
  if (typeof sessionId !== 'string' || typeof costUsd !== 'number') return [];
  if (!Number.isFinite(costUsd) || costUsd < 0) return [];
  return [
    {
      kind: 'reported',
      usage: { nativeSessionId: sessionId, costUsd, models: reportedModels(record.modelUsage) },
    },
  ];
}

export function claudeTranscriptParser(sidechain = false): TranscriptParser {
  let turnId: string | null = null;
  return {
    push(line) {
      const record = parseLine(line);
      if (!isRecord(record) || (record.isSidechain === true) !== sidechain) return [];
      if (record.type === 'cost-state') return sidechain ? [] : reported(record);
      if (record.type === 'assistant') return response(record, turnId);
      if (record.type !== 'user' || typeof record.promptId !== 'string') return [];
      turnId = record.promptId;
      return !sidechain && isRecord(record.message) && interruptText(record.message)
        ? [{ kind: 'interrupt', turnId }]
        : [];
    },
  };
}
