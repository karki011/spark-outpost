import type { SessionUpdate } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderOutput } from '../../providers/provider.ts';
import { updateSink, type UpdateSink } from './update-sink.ts';
import { createSubagentRouter } from './subagent-stream.ts';
import { createTurnMapper } from './subagent-updates.ts';

const modelOption = (value: string) => ({
  id: 'model',
  name: 'Model',
  category: 'model',
  type: 'select',
  currentValue: value,
  options: [{ value, name: value }],
});

const effortOption = (id: string, value: string) => ({
  id,
  name: 'Effort',
  category: 'thought_level',
  type: 'select',
  currentValue: value,
  options: [{ value, name: value }],
});

function harness() {
  const route = createSubagentRouter();
  const mapper = createTurnMapper('Fake', false);
  const adopt = vi.fn();
  const adoptMode = vi.fn();
  const pushed: ProviderOutput[] = [];
  const sink = updateSink({
    agentName: 'Fake',
    live: { adopt, adoptMode, options: () => [] } as unknown as UpdateSink['live'],
    mapper,
    ranModel: { see: () => [] },
    commands: { see: () => [] } as unknown as UpdateSink['commands'],
    rails: null,
    flagsRails: false,
    webReads: { see: () => [] } as unknown as UpdateSink['webReads'],
    push: (outputs) => pushed.push(...outputs),
  });
  const send = async (sessionId: string, update: Record<string, unknown>) => {
    const message = route({
      jsonrpc: '2.0',
      method: 'session/update',
      params: { sessionId, update },
    });
    if (message === null) return;
    const { params } = message as { params: { update: SessionUpdate } };
    await sink(params.update);
  };
  const reports = () => pushed.filter((output) => output.kind === 'subagent_report');
  return { send, pushed, reports, adopt, adoptMode };
}

const spawn = (id: string) =>
  ({
    sessionUpdate: 'subagent_spawned',
    subagentSessionId: id,
    name: id,
    task: 'do',
  }) as const;

const configure = (...configOptions: unknown[]) =>
  ({ sessionUpdate: 'config_option_update', configOptions }) as const;

describe('the model and effort of a sub-agent', () => {
  it('is reported when the child session first gets its configuration', async () => {
    const { send, reports } = harness();
    await send('root', spawn('child-1'));
    await send(
      'child-1',
      configure(modelOption('claude-opus-5-5'), effortOption('effort', 'high')),
    );
    expect(reports()).toEqual([
      {
        kind: 'subagent_report',
        id: 'child-1',
        report: { usage: { model: 'claude-opus-5-5', effort: 'high' } },
      },
    ]);
  });

  it('reads a Codex child the same way', async () => {
    const { send, reports } = harness();
    await send('root', spawn('child-1'));
    await send(
      'child-1',
      configure(modelOption('gpt-5.5'), effortOption('reasoning_effort', 'medium')),
    );
    expect(reports()[0]).toMatchObject({
      report: { usage: { model: 'gpt-5.5', effort: 'medium' } },
    });
  });

  it('is reported again only when it changes', async () => {
    const { send, reports } = harness();
    await send('root', spawn('child-1'));
    await send('child-1', configure(modelOption('claude-opus-5-5')));
    await send('child-1', configure(modelOption('claude-opus-5-5')));
    expect(reports()).toHaveLength(1);
    await send('child-1', configure(modelOption('claude-opus-5-5'), effortOption('effort', 'low')));
    await send('child-1', configure(modelOption('claude-sonnet-5'), effortOption('effort', 'low')));
    expect(reports().map((output) => output.report.usage)).toEqual([
      { model: 'claude-opus-5-5' },
      { effort: 'low' },
      { model: 'claude-sonnet-5' },
    ]);
  });

  it('uses the display name when the child model is a bare alias', async () => {
    const { send, reports } = harness();
    await send('root', spawn('child-1'));
    await send('child-1', {
      sessionUpdate: 'config_option_update',
      configOptions: [
        {
          id: 'model',
          category: 'model',
          type: 'select',
          currentValue: 'opus[1m]',
          options: [{ value: 'opus[1m]', name: 'Opus 4.7 (1M context)' }],
        },
      ],
    });
    expect(reports()[0]).toMatchObject({ report: { usage: { model: 'Opus 4.7' } } });
  });

  it('is not guessed when the child names no model', async () => {
    const { send, reports } = harness();
    await send('root', spawn('child-1'));
    await send('child-1', configure(modelOption('default')));
    await send('child-1', configure({ id: 'mode', category: 'mode', currentValue: 'auto' }));
    expect(reports()).toEqual([]);
  });

  it('is dropped for a child that was never announced', async () => {
    const { send, pushed } = harness();
    await send('stray', configure(modelOption('claude-opus-5-5')));
    expect(pushed).toEqual([]);
  });
});

describe('the lead session when a sub-agent is configured', () => {
  it('keeps its own settings when the configuration arrives on the child session', async () => {
    const { send, adopt, pushed } = harness();
    await send('root', spawn('child-1'));
    await send('child-1', configure(modelOption('claude-haiku-5'), effortOption('effort', 'low')));
    expect(adopt).not.toHaveBeenCalled();
    expect(pushed.some((output) => output.kind === 'session_settings')).toBe(false);
  });

  it('keeps its own settings when the configuration names a parent tool use on the root', async () => {
    const { send, adopt, pushed } = harness();
    await send('root', spawn('child-1'));
    await send('root', {
      ...configure(modelOption('claude-haiku-5')),
      _meta: { claudeCode: { parentToolUseId: 'toolu_1' } },
    });
    expect(adopt).not.toHaveBeenCalled();
    expect(pushed.some((output) => output.kind === 'session_settings')).toBe(false);
  });

  it('still adopts its own configuration changes', async () => {
    const { send, adopt } = harness();
    await send('root', configure(modelOption('claude-opus-5-5')));
    expect(adopt).toHaveBeenCalledTimes(1);
  });
});
