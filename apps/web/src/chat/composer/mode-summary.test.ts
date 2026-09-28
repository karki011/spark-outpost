import { describe, expect, it } from 'vitest';
import { choiceGroups, optionValue } from './ConfigOptions.tsx';
import { modeLabel, modeSummary, withCurrentMode } from './mode-summary.ts';

const modes = [
  { id: 'default', label: 'Manual', description: 'Always ask', kind: 'standard' },
  { id: 'acceptEdits', label: 'Accept edits', description: null, kind: 'standard' },
  { id: 'plan', label: 'Plan', description: null, kind: 'plan' },
];

describe('mode summary', () => {
  it("names the agent's mode and the harness autonomy", () => {
    expect(modeSummary('claude', 'acceptEdits', 'hands-off', modes)).toBe(
      'Accept edits · Automatic',
    );
    expect(modeSummary('claude', 'default', 'balanced', modes)).toBe('Manual · Review each step');
    expect(modeSummary('claude', 'default', null, modes)).toBe('Manual · Automatic');
  });

  it('leaves out the autonomy for a read-only mode', () => {
    expect(modeSummary('claude', 'plan', 'full-auto', modes)).toBe('Plan');
    expect(modeSummary('codex', 'read-only', 'hands-off', [])).toBe('read-only');
  });

  it('keeps a mode the agent no longer lists', () => {
    expect(modeLabel(modes, 'yolo')).toBe('yolo');
    expect(withCurrentMode(modes, 'yolo').map((mode) => mode.id)).toEqual([
      'default',
      'acceptEdits',
      'plan',
      'yolo',
    ]);
    expect(withCurrentMode(modes, 'plan')).toHaveLength(3);
  });
});

describe('generic config options', () => {
  it('reads the chat value before the agent value', () => {
    const fast = {
      type: 'boolean' as const,
      id: 'fast',
      name: 'Fast mode',
      description: null,
      category: 'model_config',
      currentValue: false,
    };
    expect(optionValue(fast, {})).toBe(false);
    expect(optionValue(fast, { fast: true })).toBe(true);
    expect(optionValue(fast, { fast: 'yes' })).toBe(false);
  });

  it('groups choices in the order the agent sent them', () => {
    const choice = (id: string, group: string | null) => ({
      id,
      label: id,
      description: null,
      group,
    });
    const groups = choiceGroups([choice('a', 'One'), choice('b', 'Two'), choice('c', 'One')]);
    expect(groups.map(([group, list]) => [group, list.map((item) => item.id)])).toEqual([
      ['One', ['a', 'c']],
      ['Two', ['b']],
    ]);
  });
});
