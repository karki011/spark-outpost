import { describe, expect, it } from 'vitest';
import { agentLabel, crewName, crewRole, crewTitle, nextCrewName } from './roles.ts';

describe('crew names', () => {
  it('draws names from each role’s pool in order', () => {
    expect([0, 1, 2, 3, 4].map((index) => crewName('builder', index))).toEqual([
      'Bolt',
      'Rivet',
      'Tack',
      'Chip',
      'Nut',
    ]);
    expect(crewName('scout', 0)).toBe('Pip');
    expect(crewName('architect', 1)).toBe('Ada');
    expect(crewName('critic', 2)).toBe('Lynx');
  });

  it('numbers a second round once a pool runs out', () => {
    expect(crewName('critic', 3)).toBe('Hawk 2');
    expect(crewName('builder', 10)).toBe('Bolt 3');
  });

  it('skips names already used in the task', () => {
    expect(nextCrewName('builder', ['Bolt', 'Tack'])).toBe('Rivet');
    expect(nextCrewName('builder', ['Bolt', 'Rivet', 'Tack'])).toBe('Chip');
    expect(nextCrewName('scout', [])).toBe('Pip');
  });

  it('labels a member by name, role, model, and effort', () => {
    expect(agentLabel('builder', 'Sonnet 5', 'medium', 'Bolt')).toBe(
      'Bolt · Builder · Sonnet 5 · medium',
    );
    expect(agentLabel('critic', '6 Sol', null)).toBe('Critic · 6 Sol');
  });

  it('names what a crew member does, for tooltips', () => {
    expect(crewRole('Pip')).toBe('scout');
    expect(crewRole('Bolt 2')).toBe('builder');
    expect(crewRole('Subash')).toBeNull();
    expect(crewTitle('Pip')).toBe('Pip · Reader — reads and answers');
    expect(crewTitle('Hawk 2')).toBe('Hawk 2 · Critic — reviews the change');
    expect(crewTitle('Someone')).toBe('Someone');
  });
});
