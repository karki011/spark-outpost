import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { messagePhase } from './message-phase.ts';
import { createUpdateMapper } from './session-updates.ts';

const said = (text: string, messageId: string, phase?: string): SessionUpdate => ({
  sessionUpdate: 'agent_message_chunk',
  messageId,
  content: { type: 'text', text },
  ...(phase ? { _meta: { codex: { phase } } } : {}),
});

describe('the phase an agent message reports', () => {
  it('reads Codex commentary and final answer', () => {
    expect(messagePhase({ codex: { phase: 'commentary' } })).toEqual({ phase: 'commentary' });
    expect(messagePhase({ codex: { phase: 'final_answer' } })).toEqual({ phase: 'final' });
  });

  it('reports nothing when the agent does not say', () => {
    expect(messagePhase(undefined)).toEqual({});
    expect(messagePhase({ codex: { phase: null } })).toEqual({});
    expect(messagePhase({ codex: { phase: 'toString' } })).toEqual({});
    expect(messagePhase({ claudeCode: {} })).toEqual({});
  });
});

describe('ACP message chunks keep their phase', () => {
  it('marks commentary and the final answer on the text they become', () => {
    const mapper = createUpdateMapper();

    expect(mapper.map(said('I will count the files.', 'm1', 'commentary'))).toEqual([
      { kind: 'text_delta', delta: 'I will count the files.', phase: 'commentary' },
    ]);
    expect(mapper.map(said('3', 'm2', 'final_answer'))).toEqual([
      { kind: 'text_delta', delta: '\n\n3', phase: 'final' },
    ]);
  });

  it('leaves text unmarked when the agent reports no phase', () => {
    const mapper = createUpdateMapper();

    expect(mapper.map(said('Done.', 'm1'))).toEqual([{ kind: 'text_delta', delta: 'Done.' }]);
  });
});
