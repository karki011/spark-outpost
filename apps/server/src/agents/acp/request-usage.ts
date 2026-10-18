import { z } from 'zod';
import type { RequestUsage } from '../../providers/provider.ts';

export const SDK_MESSAGE_METHOD = '_claude/sdkMessage';
export const RAW_REQUEST_MESSAGES = [{ type: 'assistant' }] as const;

const LABEL_MAX = 200;
const tokens = z.number().int().nonnegative().max(1_000_000_000).catch(0);

const sdkMessageSchema = z.object({
  message: z.object({
    type: z.literal('assistant'),
    parent_tool_use_id: z.null(),
    message: z.object({
      id: z.string().min(1).max(LABEL_MAX),
      model: z.string().min(1).max(LABEL_MAX),
      usage: z.object({
        input_tokens: tokens,
        output_tokens: tokens,
        cache_read_input_tokens: tokens,
        cache_creation_input_tokens: tokens,
        cache_creation: z
          .object({ ephemeral_5m_input_tokens: tokens, ephemeral_1h_input_tokens: tokens })
          .nullish()
          .catch(null),
      }),
    }),
  }),
});

export function parseRequestUsage(params: unknown): RequestUsage | null {
  const parsed = sdkMessageSchema.safeParse(params);
  if (!parsed.success) return null;
  const { id, model, usage } = parsed.data.message.message;
  if (model === '<synthetic>') return null;
  return {
    key: id,
    model,
    input: usage.input_tokens,
    output: usage.output_tokens,
    cachedRead: usage.cache_read_input_tokens,
    cachedWrite: usage.cache_creation_input_tokens,
    buckets: usage.cache_creation
      ? {
          short: usage.cache_creation.ephemeral_5m_input_tokens,
          long: usage.cache_creation.ephemeral_1h_input_tokens,
        }
      : null,
  };
}
