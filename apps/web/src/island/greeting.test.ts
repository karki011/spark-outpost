import { describe, expect, it } from 'vitest';
import { greetingDue, greetingLine } from './greeting.ts';
import { seedIndex } from './seed-index.ts';

const friendly = { personality: 'friendly' as const, name: 'Subash' };

describe('greetings', () => {
  const morning = new Date(2026, 8, 30, 9, 0);

  it('greets once a day by first name, then after a long break only', () => {
    expect(greetingDue(null, null, morning)).toBe('first_open');
    expect(greetingDue(morning.getTime() - 60_000, '2026-9-30', morning)).toBeNull();
    expect(greetingDue(morning.getTime() - 3 * 3_600_000, '2026-9-30', morning)).toBe(
      'welcome_back',
    );
    expect(greetingLine(friendly, 'first_open', morning)).toBe('Good morning, Subash!');
    expect(greetingLine(friendly, 'welcome_back', morning)).toBe('Welcome back, Subash!');
  });

  it('falls back gracefully without a name', () => {
    expect(greetingLine({ personality: 'friendly', name: '' }, 'welcome_back', morning)).toBe(
      'Welcome back!',
    );
  });
});

describe('seedIndex', () => {
  it('spreads seeds evenly enough', () => {
    const hits = new Set(Array.from({ length: 30 }, (_, index) => seedIndex(`k${index}`, 3)));
    expect(hits).toEqual(new Set([0, 1, 2]));
  });
});
