import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable';
import { describe, expect, it } from 'vitest';
import { findOption, planConfig } from './session-config.ts';

const options: SessionConfigOption[] = [
  {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue: 'agent',
    options: [
      { value: 'read-only', name: 'Ask for approval' },
      { value: 'agent', name: 'Auto review' },
    ],
  },
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: 'default',
    options: [
      {
        group: 'current',
        name: 'Current',
        options: [
          { value: 'default', name: 'Default' },
          { value: 'opus[1m]', name: 'Opus 5.5' },
        ],
      },
    ],
  },
];

describe('session config planning', () => {
  it('matches by value, then by display name, and skips values already set', () => {
    expect(
      planConfig(options, [
        { category: 'mode', value: 'read-only' },
        { category: 'model', value: 'claude-opus-5-5', label: 'Opus 5.5' },
      ]),
    ).toEqual({
      changes: [
        { configId: 'mode', value: 'read-only' },
        { configId: 'model', value: 'opus[1m]' },
      ],
      unmatched: [],
    });
    expect(planConfig(options, [{ category: 'mode', value: 'agent' }]).changes).toEqual([]);
  });

  it('reports wishes the agent cannot satisfy and ignores empty wishes', () => {
    const plan = planConfig(options, [
      { category: 'model', value: 'gpt-9' },
      { category: 'thought_level', value: 'high' },
      { category: 'model', value: null },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.unmatched.map((wish) => wish.category)).toEqual(['model', 'thought_level']);
  });
});

describe('findOption', () => {
  it('prefers the category and falls back to a known id when the category is missing', () => {
    const options = [
      { id: 'mode', name: 'Mode' },
      { id: 'reasoning_effort', name: 'Effort' },
      { id: 'other', name: 'Mode', category: 'model' },
    ];
    expect(findOption(options, 'model')?.id).toBe('other');
    expect(findOption(options, 'mode')?.id).toBe('mode');
    expect(findOption(options, 'thought_level')?.id).toBe('reasoning_effort');
  });
});
