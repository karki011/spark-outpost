import { describe, expect, it } from 'vitest';
import { greeting, hello, quietCard, quietSummary, sparkMood, timeOfDay } from './voice.ts';

describe('timeOfDay', () => {
  it('follows the clock', () => {
    expect(timeOfDay(0)).toBe('Working late');
    expect(timeOfDay(4)).toBe('Working late');
    expect(timeOfDay(5)).toBe('Good morning');
    expect(timeOfDay(11)).toBe('Good morning');
    expect(timeOfDay(12)).toBe('Good afternoon');
    expect(timeOfDay(17)).toBe('Good afternoon');
    expect(timeOfDay(18)).toBe('Good evening');
    expect(timeOfDay(23)).toBe('Good evening');
  });
});

describe('greeting', () => {
  it('keeps the friendly greeting and falls back when there is no name', () => {
    expect(greeting({ personality: 'friendly', name: 'Sam' }, 9)).toBe('Good morning, Sam');
    expect(greeting({ personality: 'friendly', name: '' }, 9)).toBe('Good morning, there');
  });

  it('is livelier when playful and plain when just the facts', () => {
    expect(greeting({ personality: 'playful', name: 'Sam' }, 20)).toBe('Evening, Sam!');
    expect(greeting({ personality: 'facts', name: 'Sam' }, 14)).toBe('Good afternoon, Sam.');
    expect(greeting({ personality: 'facts', name: '' }, 14)).toBe('Good afternoon.');
  });
});

describe('hello', () => {
  it('waves by name in each personality', () => {
    expect(hello({ personality: 'friendly', name: 'Sam' })).toBe('Hi Sam 👋');
    expect(hello({ personality: 'playful', name: 'Sam' })).toBe('Hey Sam! 👋 Ready when you are.');
    expect(hello({ personality: 'facts', name: 'Sam' })).toBe('Hi Sam.');
    expect(hello({ personality: 'friendly', name: '' })).toBe('Hi there 👋');
  });
});

describe('quiet lines', () => {
  it('keeps the friendly wording and trims the facts wording', () => {
    const friendly = { personality: 'friendly' as const, name: 'Sam' };
    expect(quietSummary(friendly)).toBe('All quiet. Start something new below.');
    expect(quietCard(friendly)).toBe('All quiet. Nothing needs you and no agents are running.');
    expect(quietSummary({ personality: 'facts', name: 'Sam' })).toBe('Nothing running.');
    expect(quietCard({ personality: 'playful', name: 'Sam' })).toContain('Nothing needs you, Sam');
    expect(quietCard({ personality: 'playful', name: '' })).toMatch(/^Nothing needs you, and/);
  });
});

describe('sparkMood', () => {
  it('sleeps when Spark is off and follows the personality when on', () => {
    expect(sparkMood('playful', false)).toBe('sleep');
    expect(sparkMood('playful', true)).toBe('happy');
    expect(sparkMood('friendly', true)).toBeNull();
    expect(sparkMood('facts', true)).toBe('working');
  });
});
