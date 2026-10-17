import { describe, expect, it } from 'vitest';
import { parseRequestUsage } from './request-usage.ts';

const message = (usage: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  sessionId: 's',
  message: {
    type: 'assistant',
    parent_tool_use_id: null,
    message: { id: 'msg_1', model: 'glm-5.1', usage },
    ...extra,
  },
});

describe('parseRequestUsage', () => {
  it('reports no buckets when the provider sends no cache breakdown', () => {
    const usage = {
      input_tokens: 10,
      output_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 40,
    };
    expect(parseRequestUsage(message(usage))?.buckets).toBeNull();
  });

  it('refuses other message types and broken counts', () => {
    expect(parseRequestUsage({ message: { type: 'result' } })).toBeNull();
    expect(parseRequestUsage(null)).toBeNull();
    const broken = parseRequestUsage(message({ input_tokens: -3, output_tokens: 'many' }));
    expect(broken).toMatchObject({ input: 0, output: 0, cachedRead: 0, cachedWrite: 0 });
  });
});
