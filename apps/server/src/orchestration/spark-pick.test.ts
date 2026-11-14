import { describe, expect, it } from 'vitest';
import type { MentionableSpark } from '../persistence/spark-mentions.ts';
import { pickFor, type Handoff } from './spark-child.ts';

function handoff(provider: string, connected: readonly string[]): Handoff {
  return {
    deps: { providers: new Map(connected.map((id) => [id, {}])) },
    input: { provider, settings: { model: 'chat-model', effort: 'low' } },
  } as unknown as Handoff;
}

const spark = (extra: Partial<MentionableSpark>): MentionableSpark => ({
  id: 's1',
  name: 'Scribe',
  role: 'Release notes writer',
  provider: 'claude',
  model: 'claude-haiku-5-5',
  effort: 'high',
  connected: true,
  ...extra,
});

describe('which agent a Spark’s step runs on', () => {
  it('uses the Spark’s own model and effort on its own provider', () => {
    expect(pickFor(handoff('codex', ['claude', 'codex']), spark({}))).toEqual({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'high',
    });
    expect(pickFor(handoff('claude', ['claude']), spark({}))).toEqual({
      provider: 'claude',
      model: 'claude-haiku-5-5',
      effort: 'high',
    });
  });

  it('falls back to the chat’s model and effort where the Spark sets none', () => {
    expect(pickFor(handoff('claude', ['claude']), spark({ model: null, effort: null }))).toEqual({
      provider: 'claude',
      model: 'chat-model',
      effort: 'low',
    });
    expect(pickFor(handoff('codex', ['codex']), spark({ connected: false }))).toEqual({
      provider: 'codex',
      model: 'chat-model',
      effort: 'low',
    });
  });
});
