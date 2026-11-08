import { IdleCompaction } from '@agentclientprotocol/claude-agent-acp/dist/idle-compaction.js';
import { describe, expect, it } from 'vitest';
import { agentDefinitions } from './agents.ts';

type ClaudeOptions = { promptSuggestions: boolean; env: Record<string, string> };

const optionsOf = (meta: Record<string, unknown> | undefined) =>
  (meta as { claudeCode: { options: ClaudeOptions } }).claudeCode.options;

const sessions = [
  optionsOf(agentDefinitions.claude.projectSessionMeta?.(['/work/lib'])),
  optionsOf(agentDefinitions.claude.conversationSessionMeta?.()),
  optionsOf(agentDefinitions.claude.doSessionMeta?.([])),
];

interface Armed {
  noteRequest(usage: Record<string, unknown>, messageId?: string): void;
  onIdle(): void;
}

function idleCompaction(env: Record<string, string>) {
  const timers: number[] = [];
  const logs: string[] = [];
  const built = new IdleCompaction(
    {
      isBusy: () => false,
      contextTokens: () => 900_000,
      settings: () => ({}),
      compact: async () => undefined,
      log: (line: string) => logs.push(line),
    },
    {
      env,
      setTimeout: (_callback: () => void, ms: number) => {
        timers.push(ms);
        return undefined;
      },
    },
  ) as unknown as Armed;
  built.noteRequest({ cache_creation: { ephemeral_1h_input_tokens: 900_000 } }, 'msg-1');
  built.onIdle();
  return { timers, logs };
}

describe('Claude calls that would run outside a turn', () => {
  it('asks for no predicted next prompt', () => {
    for (const options of sessions) expect(options.promptSuggestions).toBe(false);
  });

  it('never arms the adapter’s idle compaction, even on a large cached context', () => {
    expect(idleCompaction({}).timers).toHaveLength(1);
    for (const options of sessions) {
      const { timers, logs } = idleCompaction(options.env);
      expect(timers).toEqual([]);
      expect(logs.join('\n')).toContain('below the');
    }
  });
});
