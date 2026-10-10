import type * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { createUpdateMapper } from './session-updates.ts';
import { watchRanModel } from './ran-model.ts';

const select = (
  id: string,
  category: string,
  currentValue: string,
  values: string[],
): acp.SessionConfigOption => ({
  id,
  name: id,
  category,
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value, name: value })),
});

const reporting = (model: string) => [
  select('mode', 'mode', 'auto', ['default', 'auto']),
  select('model', 'model', model, ['default', 'sonnet', 'opus']),
  select('effort', 'thought_level', 'medium', ['medium', 'high']),
];

const usage = (model: string | null): acp.SessionUpdate => ({
  sessionUpdate: 'usage_update',
  used: 28_768,
  size: 1_000_000,
  ...(model ? { _meta: { '_claude/model': model } } : {}),
});

function watching(model: string) {
  const mapper = createUpdateMapper('Claude');
  return watchRanModel('claude', 'Claude', { options: () => reporting(model) }, mapper.note);
}

describe('the model a turn really ran on', () => {
  it('replaces the reported model and says so when the turn ran on another one', () => {
    const watch = watching('sonnet');
    expect(watch.see(usage('claude-opus-5-5'))).toEqual([
      {
        kind: 'session_settings',
        model: 'opus',
        effort: 'medium',
        mode: 'auto',
        options: {},
      },
      { kind: 'step_started', name: 'Claude ran this turn on Opus 5.5, not Sonnet 5' },
      { kind: 'step_finished', name: 'Claude ran this turn on Opus 5.5, not Sonnet 5' },
    ]);
  });

  it('names the model that ran when the pinned one was not offered and the session stayed on the default', () => {
    const mapper = createUpdateMapper('Claude');
    const live = { options: () => reporting('default'), unpinnedModel: () => 'sonnet' };
    const watch = watchRanModel('claude', 'Claude', live, mapper.note);
    expect(watch.see(usage('claude-opus-5-5'))).toEqual([
      { kind: 'step_started', name: 'Claude ran this turn on Opus 5.5, not sonnet' },
      { kind: 'step_finished', name: 'Claude ran this turn on Opus 5.5, not sonnet' },
    ]);
    expect(watch.see(usage('claude-opus-5-5'))).toEqual([]);
  });

  it('says it once a turn', () => {
    const watch = watching('sonnet');
    watch.see(usage('claude-opus-5-5'));
    expect(watch.see(usage('claude-opus-5-5'))).toEqual([]);
  });

  it('stays quiet when the turn ran on the reported model, under any of its ids', () => {
    expect(watching('sonnet').see(usage('claude-sonnet-5'))).toEqual([]);
    expect(watching('opus').see(usage('claude-opus-5-5[1m]'))).toEqual([]);
  });

  it('makes no claim about a model it has no card for, or when none is reported', () => {
    expect(watching('default').see(usage('claude-opus-5-5'))).toEqual([]);
    expect(watching('sonnet').see(usage('some-new-model'))).toEqual([]);
    expect(watching('sonnet').see(usage(null))).toEqual([]);
  });
});
