import { describe, expect, it } from 'vitest';
import type { CrewAgent, CrewState } from './crew-model.ts';
import { tvMenuPane } from './tv-menu-pane.tsx';

function agent(id: string, state: CrewState): CrewAgent {
  return {
    id,
    role: 'builder',
    name: id,
    provider: 'claude',
    model: null,
    effort: null,
    state,
    line: '',
    tokens: null,
    costUsd: null,
    costSource: null,
    durationMs: null,
  };
}

describe('Agent TV menu item', () => {
  it('is absent in a chat with no agents', () => {
    expect(tvMenuPane('chat', [], null)).toBeNull();
  });

  it('is checked only while the TV shows this chat', () => {
    const agents = [agent('a', 'done')];
    expect(tvMenuPane('chat', agents, 'chat')?.open).toBe(true);
    expect(tvMenuPane('chat', agents, 'other')?.open).toBe(false);
    expect(tvMenuPane('chat', agents, null)?.open).toBe(false);
  });

  it('signals how many agents are working, and nothing when none are', () => {
    expect(tvMenuPane('chat', [agent('a', 'done')], null)?.signal).toBeNull();
    expect(tvMenuPane('chat', [agent('a', 'working')], null)?.signal).toEqual({
      note: '1 working',
      summary: '1 agent working',
      live: true,
    });
    expect(
      tvMenuPane(
        'chat',
        [agent('a', 'working'), agent('b', 'thinking'), agent('c', 'done')],
        'chat',
      )?.signal?.summary,
    ).toBe('2 agents working');
  });
});
