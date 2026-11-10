import { describe, expect, it } from 'vitest';
import type { ConversationSummary, ProviderCapabilities } from '@spark-outpost/contracts';
import type { RunItem } from './home-model.ts';
import { groupRunning, runMode } from './run-mode.ts';

const claude = {
  defaultMode: 'default',
  modes: [
    { id: 'default', label: 'Manual', description: null, kind: 'standard' },
    { id: 'auto', label: 'Auto', description: null, kind: null },
    { id: 'plan', label: 'Plan', description: null, kind: 'plan' },
  ],
} as unknown as ProviderCapabilities;
const caps = new Map([['claude' as const, claude]]);

function item(id: string, agentMode: string | null | undefined, provider = 'claude'): RunItem {
  const chat = {
    id,
    title: id,
    latestRun: { status: 'running', provider, agentMode },
  } as unknown as ConversationSummary;
  return { chat, step: '', provider, percent: null };
}

describe('run mode', () => {
  it('labels the stored mode and whether it asks first', () => {
    expect(runMode(item('a', 'default').chat, caps)).toEqual({
      group: 'ask',
      label: 'Manual · will stop and ask',
    });
    expect(runMode(item('b', 'auto').chat, caps)).toEqual({
      group: 'free',
      label: 'Auto · runs without asking',
    });
    expect(runMode(item('c', 'plan').chat, caps)).toEqual({
      group: 'other',
      label: 'Plan · read only',
    });
  });

  it('falls back to the provider default when the run stored no mode', () => {
    expect(runMode(item('a', null).chat, caps)?.label).toBe('Manual · will stop and ask');
  });

  it('says nothing until the provider capabilities are known', () => {
    expect(runMode(item('a', 'auto').chat, new Map())).toBeNull();
    expect(runMode(item('a', 'auto', 'unknown').chat, caps)).toBeNull();
  });

  it('groups running chats by whether they stop and ask', () => {
    const groups = groupRunning(
      [item('a', 'auto'), item('b', 'default'), item('c', 'plan'), item('d', 'default')],
      caps,
    );
    expect(groups.map((group) => [group.title, group.items.map((i) => i.chat.id)])).toEqual([
      ['Will stop and ask', ['b', 'd']],
      ['Runs without asking', ['a']],
      ['Still working', ['c']],
    ]);
  });

  it('puts chats of unknown mode in the plain group', () => {
    const groups = groupRunning([item('a', 'auto')], new Map());
    expect(groups.map((group) => group.title)).toEqual(['Still working']);
  });
});
