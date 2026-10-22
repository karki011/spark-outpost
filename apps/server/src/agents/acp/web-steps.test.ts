import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { createUpdateMapper } from './session-updates.ts';

const fetchCall = (title: string): SessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: 'f1',
  title,
  kind: 'fetch',
  status: 'pending',
  rawInput: {},
});

const fetchUpdate = (fields: Record<string, unknown>): SessionUpdate =>
  ({ sessionUpdate: 'tool_call_update', toolCallId: 'f1', ...fields }) as SessionUpdate;

const steps = (outputs: ProviderOutput[]) =>
  outputs.flatMap((output) =>
    output.kind === 'step_started' || output.kind === 'step_finished'
      ? [[output.kind, output.name]]
      : [],
  );

describe('web steps in the work log', () => {
  it('names a WebFetch by its site once the address streams in', () => {
    const mapper = createUpdateMapper();
    expect(steps(mapper.map(fetchCall('Fetch')))).toEqual([]);
    const addressed = fetchUpdate({
      title: 'Fetch https://docs.example.com/guide?page=2',
      rawInput: { url: 'https://docs.example.com/guide?page=2', prompt: 'summary' },
    });
    expect(steps(mapper.map(addressed))).toEqual([['step_started', 'Fetched docs.example.com']]);
    expect(steps(mapper.map(fetchUpdate({ status: 'completed' })))).toEqual([
      ['step_finished', 'Fetched docs.example.com'],
    ]);
  });

  it('still shows a fetch that ends before its address arrives', () => {
    const mapper = createUpdateMapper();
    mapper.map(fetchCall('Fetch'));
    expect(steps(mapper.map(fetchUpdate({ status: 'failed' })))).toEqual([
      ['step_started', 'Fetch'],
      ['step_finished', 'Fetch'],
      ['step_started', 'Failed: Fetch'],
      ['step_finished', 'Failed: Fetch'],
    ]);
  });

  it('names a web search the moment it starts', () => {
    const mapper = createUpdateMapper();
    const search: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 's1',
      title: 'Web search',
      kind: 'fetch',
      status: 'pending',
    };
    expect(steps(mapper.map(search))).toEqual([['step_started', 'Searched the web']]);
  });
});
