import { describe, expect, it } from 'vitest';
import {
  briefOffLine,
  greeting,
  hello,
  mapIntro,
  nothingFlagged,
  quietSummary,
  quietToday,
  sparkMood,
  timeOfDay,
} from './voice.ts';

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
    expect(quietSummary({ personality: 'facts', name: 'Sam' })).toBe('Nothing running.');
    expect(nothingFlagged(friendly)).toBe('Nothing is flagged');
    expect(nothingFlagged({ personality: 'playful', name: 'Sam' })).toBe(
      'Nothing is flagged, Sam. Nice.',
    );
    expect(nothingFlagged({ personality: 'playful', name: '' })).toBe('Nothing is flagged. Nice.');
    expect(nothingFlagged({ personality: 'facts', name: 'Sam' })).toBe('Nothing flagged');
    expect(quietToday(friendly)).toBe('Nothing else on the go today. A fresh start.');
    expect(quietToday({ personality: 'facts', name: 'Sam' })).toBe('No other chats today.');
  });
});

describe('briefOffLine', () => {
  it('says the rules still sort the list in every personality', () => {
    expect(briefOffLine({ personality: 'friendly', name: 'Sam' })).toBe(
      'The brief is off. Rules still sort the list below.',
    );
    expect(briefOffLine({ personality: 'playful', name: 'Sam' })).toMatch(/napping/);
    expect(briefOffLine({ personality: 'facts', name: 'Sam' })).toBe(
      'Brief off. Rules sort the list.',
    );
  });
});

describe('mapIntro', () => {
  it('explains core, shared and chat changes in every personality', () => {
    for (const personality of ['friendly', 'playful', 'facts'] as const) {
      const line = mapIntro({ personality, name: 'Sam' });
      expect(line).toMatch(/core/i);
      expect(line).toMatch(/chat/);
    }
    expect(mapIntro({ personality: 'playful', name: 'Sam' })).toMatch(/constellations/);
  });
});

describe('sparkMood', () => {
  it('follows the personality', () => {
    expect(sparkMood('playful')).toBe('happy');
    expect(sparkMood('friendly')).toBeNull();
    expect(sparkMood('facts')).toBe('working');
  });
});
