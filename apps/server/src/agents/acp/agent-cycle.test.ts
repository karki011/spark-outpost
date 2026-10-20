import { describe, expect, it } from 'vitest';
import { startsAgentCycle } from './agent-cycle.ts';

describe('what starts an agent cycle between turns', () => {
  it('counts the agent writing, thinking or using a tool', () => {
    expect(
      startsAgentCycle({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hi' },
      }),
    ).toBe(true);
    expect(startsAgentCycle({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Read' })).toBe(
      true,
    );
    expect(
      startsAgentCycle({
        sessionUpdate: 'session_info_update',
        _meta: { sparkSubagent: { event: 'task', id: 'task-1', ended: true } },
      }),
    ).toBe(true);
  });

  it('ignores trailing bookkeeping such as usage, commands and a second cycle end', () => {
    expect(
      startsAgentCycle({
        sessionUpdate: 'usage_update',
        used: 1,
        size: 2,
        _meta: { '_claude/origin': { kind: 'task-notification' } },
      }),
    ).toBe(false);
    expect(
      startsAgentCycle({ sessionUpdate: 'available_commands_update', availableCommands: [] }),
    ).toBe(false);
    expect(startsAgentCycle({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toBe(
      false,
    );
  });
});
