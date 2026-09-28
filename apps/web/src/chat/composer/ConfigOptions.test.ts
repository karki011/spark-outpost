import { describe, expect, it } from 'vitest';
import { choiceGroups, optionValue } from './ConfigOptions.tsx';

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
