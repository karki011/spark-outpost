import { describe, expect, it } from 'vitest';
import { agentInfoOutputs } from '../src/agents/acp/agent-info.ts';

describe('the adapter an agent reports in initialize', () => {
  it('keeps the name and version and drops the title', () => {
    const agentInfo = {
      name: '@agentclientprotocol/claude-agent-acp',
      title: 'Claude Agent',
      version: '0.101.0',
    };
    expect(agentInfoOutputs({ agentInfo })).toEqual([
      { kind: 'agent_info', name: '@agentclientprotocol/claude-agent-acp', version: '0.101.0' },
    ]);
  });

  it('trims surrounding spaces', () => {
    expect(agentInfoOutputs({ agentInfo: { name: ' codex-acp ', version: ' 2.6.0\n' } })).toEqual([
      { kind: 'agent_info', name: 'codex-acp', version: '2.6.0' },
    ]);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an empty name', { name: '', version: '1.0.0' }],
    ['a blank version', { name: 'codex-acp', version: '   ' }],
    ['a number version', { name: 'codex-acp', version: 2 }],
    ['a name too long', { name: 'a'.repeat(201), version: '1.0.0' }],
    ['a version too long', { name: 'codex-acp', version: '1'.repeat(101) }],
    ['a control character', { name: 'codex\u0007acp', version: '1.0.0' }],
    ['a line break inside', { name: 'codex\nacp', version: '1.0.0' }],
    ['text outside ASCII', { name: 'codex-acp', version: '1.0.0‮' }],
  ])('records nothing for %s', (_label, agentInfo) => {
    expect(agentInfoOutputs({ agentInfo } as Parameters<typeof agentInfoOutputs>[0])).toEqual([]);
  });

  it('accepts the longest allowed values', () => {
    const name = 'n'.repeat(200);
    const version = 'v'.repeat(100);
    expect(agentInfoOutputs({ agentInfo: { name, version } })).toEqual([
      { kind: 'agent_info', name, version },
    ]);
  });
});
