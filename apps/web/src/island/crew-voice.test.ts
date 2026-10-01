import { describe, expect, it } from 'vitest';
import { crewLine, doneLine, greetingDue, greetingLine, seedIndex } from './crew-voice.ts';

const friendly = { personality: 'friendly' as const, name: 'Subash' };
const facts = { personality: 'facts' as const, name: 'Subash' };
const nameless = { personality: 'playful' as const, name: '' };

describe('crew voice', () => {
  it('picks the same phrasing for the same run so lines never flicker', () => {
    const input = {
      role: 'builder' as const,
      who: 'Bolt',
      fact: 'Editing upload.ts',
      seed: 'run-1',
    };
    const first = crewLine(friendly, 'working', input);
    expect(crewLine(friendly, 'working', input)).toBe(first);
    expect(first).toContain('Bolt');
    expect(first).toContain('editing upload.ts');
  });

  it('varies phrasing across runs but always keeps the fact', () => {
    const lines = new Set(
      Array.from({ length: 20 }, (_, index) =>
        crewLine(friendly, 'working', {
          role: 'scout',
          who: 'Pip',
          fact: 'Reading resize.ts',
          seed: `run-${index}`,
        }),
      ),
    );
    expect(lines.size).toBeGreaterThan(1);
    for (const line of lines) expect(line).toContain('reading resize.ts');
  });

  it('keeps commands and costs intact and stays plain for Just the facts', () => {
    expect(
      crewLine(facts, 'waiting', {
        role: 'builder',
        who: 'Tack',
        fact: 'pnpm add -D vitest',
        seed: 's',
      }),
    ).toBe('Tack needs you: pnpm add -D vitest');
    expect(
      crewLine(friendly, 'done', { role: null, who: 'Spark', fact: '$0.42', seed: 's' }),
    ).toContain('$0.42');
  });

  it('spreads seeds evenly enough', () => {
    const hits = new Set(Array.from({ length: 30 }, (_, index) => seedIndex(`k${index}`, 3)));
    expect(hits).toEqual(new Set([0, 1, 2]));
  });
});

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
    expect(greetingLine({ ...nameless, personality: 'friendly' }, 'welcome_back', morning)).toBe(
      'Welcome back!',
    );
    expect(doneLine(nameless, 'kept 3 files', 'r')).toBe('Done: kept 3 files.');
    expect(doneLine(friendly, 'kept 3 files', 'r')).toMatch(/Subash.*kept 3 files\.$/);
  });
});
