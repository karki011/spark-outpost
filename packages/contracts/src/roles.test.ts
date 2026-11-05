import { describe, expect, it } from 'vitest';
import { agentLabel, crewRole, crewTitle } from './roles.ts';

describe('crew names', () => {
  it('labels a member by name, role, model, and effort', () => {
    expect(agentLabel('builder', 'Sonnet 5', 'medium', 'Bolt')).toBe(
      'Bolt · Builder · Sonnet 5 · medium',
    );
    expect(agentLabel('critic', '6 Sol', null)).toBe('Critic · 6 Sol');
  });

  it('names what a crew member does, for tooltips', () => {
    expect(crewRole('Pip')).toBe('scout');
    expect(crewRole('Bolt 2')).toBe('builder');
    expect(crewRole('Alex')).toBeNull();
    expect(crewTitle('Pip')).toBe('Pip · Reader — reads and answers');
    expect(crewTitle('Hawk 2')).toBe('Hawk 2 · Critic — reviews the change');
    expect(crewTitle('Someone')).toBe('Someone');
  });
});
