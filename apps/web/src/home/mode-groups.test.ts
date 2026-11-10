import { describe, expect, it } from 'vitest';
import type { ChatSettings } from '@spark-outpost/contracts';
import { groupByMode, modeInfo, modeNote } from './mode-groups.ts';

const settings = (agentMode: string | null): ChatSettings => ({
  provider: 'claude',
  model: null,
  effort: null,
  permission: null,
  agentMode,
  level: null,
  options: {},
});

describe('modeInfo', () => {
  it('names the mode and says whether it asks first', () => {
    const manual = modeInfo(settings('default'), undefined);
    const auto = modeInfo(settings('auto'), undefined);
    const plan = modeInfo(settings('plan'), undefined);
    expect(modeNote(manual)).toMatch(/will stop and ask$/);
    expect(modeNote(auto)).toMatch(/runs without asking$/);
    expect(modeNote(plan)).toMatch(/read only$/);
  });
});

describe('groupByMode', () => {
  it('separates modes that ask, modes that do not and chats whose mode is unknown', () => {
    const manual = modeInfo(settings('default'), undefined);
    const auto = modeInfo(settings('auto'), undefined);
    const modes = new Map([
      ['a', manual],
      ['b', auto],
      ['c', null],
    ]);
    const groups = groupByMode(['a', 'b', 'c', 'd'], (id) => modes.get(id) ?? null);
    expect(groups).toEqual({ asking: ['a'], free: ['b'], unknown: ['c', 'd'] });
  });
});
