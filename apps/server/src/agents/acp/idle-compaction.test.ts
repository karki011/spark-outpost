import { describe, expect, it } from 'vitest';
import type { SparkSessionPrefs } from '@spark-outpost/contracts';
import { claudeSessionMeta } from './agents.ts';
import { CLAUDE_DO_TOOLS, CLAUDE_READ_TOOLS } from './claude-tools.ts';
import { withClaudeSpark } from './spark-instructions.ts';

const PREFS: SparkSessionPrefs = {
  displayName: 'Sam',
  personality: 'facts',
  agentInstructions: '',
};

describe('Compact idle conversations', () => {
  function env(meta: Record<string, unknown>) {
    return (meta.claudeCode as { options: { env?: Record<string, string> } }).options.env;
  }

  it('keeps Claude from compacting an idle chat unless the user turned it on', () => {
    const off = withClaudeSpark(null, { ...PREFS, compactIdleConversations: false }, true);
    expect(env(claudeSessionMeta(CLAUDE_DO_TOOLS, [], off, true, true, []))).toEqual({
      CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: String(Number.MAX_SAFE_INTEGER),
    });
    const on = withClaudeSpark(null, { ...PREFS, compactIdleConversations: true }, true);
    expect(env(claudeSessionMeta(CLAUDE_DO_TOOLS, [], on, true, true, []))).toBeUndefined();
    expect(env(claudeSessionMeta(CLAUDE_READ_TOOLS, [], on))).toBeUndefined();
  });
});
