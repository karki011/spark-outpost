import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it, vi } from 'vitest';
import {
  NativeSubagentRuntime,
  childModelOption,
} from '@agentclientprotocol/claude-agent-acp/dist/native-subagents.js';
import packageJson from '@agentclientprotocol/claude-agent-acp/package.json' with { type: 'json' };
import { subagentConfiguration } from './subagent-config.ts';

const PINNED_VERSION = '0.101.0';
const CHILD_SESSION = 'child-session';
const TOOL_USE = 'toolu_1';

function announcedChild() {
  const child = {
    sessionId: CHILD_SESSION,
    parentSessionId: 'root',
    parentToolUseId: TOOL_USE,
    announced: true,
  };
  const session = { nativeSubagentsByTaskId: new Map([['task-1', child]]) };
  const publish = vi.fn();
  const runtime = new NativeSubagentRuntime('air', 'root', session as never, publish, {
    log: vi.fn(),
  });
  return { runtime, publish };
}

const effortOption: SessionConfigOption = {
  id: 'effort',
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: 'high',
  options: [{ value: 'high', name: 'High' }],
};

describe('the pinned claude-agent-acp adapter and sub-agent configuration', () => {
  it('is the version the sub-agent model claim was verified against', () => {
    expect(packageJson.version).toBe(PINNED_VERSION);
  });

  it('builds a child model as a single-entry option in the model category', () => {
    const option = childModelOption({ value: 'claude-opus-5-5', name: 'Opus 5.5' });
    expect(option).toMatchObject({
      category: 'model',
      type: 'select',
      currentValue: 'claude-opus-5-5',
      options: [{ value: 'claude-opus-5-5', name: 'Opus 5.5' }],
    });
    expect(subagentConfiguration([option])).toEqual({ model: 'claude-opus-5-5' });
  });

  it('sends a child response model on the root session for the runtime to reroute', async () => {
    const { runtime } = announcedChild();
    const deliver = vi.fn();
    await runtime.reportModel(TOOL_USE, 'claude-opus-5-5', deliver);
    const { sessionId, update } = deliver.mock.calls[0]![0];
    expect(sessionId).toBe('root');
    expect(update._meta).toEqual({ claudeCode: { parentToolUseId: TOOL_USE } });
  });

  it('publishes the model and effort of an announced child on the child session id', async () => {
    const { runtime, publish } = announcedChild();
    const deliver = vi.fn();
    await runtime.reportModel(TOOL_USE, 'claude-opus-5-5', deliver);
    const rerouted = await runtime.route(deliver.mock.calls[0]![0], deliver);
    expect(rerouted).toBeNull();
    await runtime.reportConfiguration(CHILD_SESSION, [effortOption]);
    const published = publish.mock.calls.map(([notification]) => notification);
    expect(published.every((notification) => notification.sessionId === CHILD_SESSION)).toBe(true);
    const last = published.at(-1)!;
    expect(last.update.sessionUpdate).toBe('config_option_update');
    expect(subagentConfiguration(last.update.configOptions)).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
    });
  });
});
