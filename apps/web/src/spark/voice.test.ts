import { describe, expect, it } from 'vitest';
import {
  briefOffLine,
  greeting,
  headline,
  headlineMood,
  type HeadlineFacts,
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

const FACTS: HeadlineFacts = {
  kind: 'board',
  hour: 9,
  waiting: 0,
  working: 0,
  updates: 0,
  failed: 0,
  meeting: null,
  minutes: 0,
};
const SAM = { personality: 'friendly' as const, name: 'Sam' };

describe('headline', () => {
  it('opens the board with the greeting and states what needs the user', () => {
    expect(headline(SAM, FACTS)).toBe('Good morning, Sam. All quiet. Start something new below.');
    expect(headline(SAM, { ...FACTS, waiting: 2, working: 1 })).toBe(
      'Good morning, Sam. 2 things need you and 1 agent is working.',
    );
    expect(headline({ personality: 'facts', name: '' }, { ...FACTS, waiting: 1 })).toBe(
      'Good morning. 1 thing needs you.',
    );
    expect(headline({ personality: 'playful', name: 'Sam' }, { ...FACTS, hour: 20 })).toMatch(
      /^Evening, Sam! /,
    );
  });

  it('says what landed while the user was away and how many stopped', () => {
    const since = { ...FACTS, kind: 'since-you-left' as const, updates: 3, failed: 1 };
    expect(headline(SAM, since)).toBe(
      'Good morning, Sam. 3 updates landed while you were away, 1 stopped with an error.',
    );
    expect(headline({ personality: 'facts', name: 'Sam' }, { ...since, failed: 0 })).toBe(
      'Good morning, Sam. 3 updates since you left.',
    );
  });

  it('names the meeting, how far it is and what waits first', () => {
    const meeting = { ...FACTS, kind: 'meeting' as const, meeting: 'Design sync', minutes: 5 };
    expect(headline(SAM, meeting)).toBe('Design sync starts in 5 minutes.');
    expect(headline(SAM, { ...meeting, minutes: 1, waiting: 1 })).toBe(
      'Design sync starts in 1 minute. 1 thing needs you first.',
    );
    expect(headline(SAM, { ...meeting, minutes: 0 })).toBe('Design sync starts now.');
    expect(headline(SAM, { ...meeting, minutes: -3 })).toBe('Design sync started 3 minutes ago.');
  });

  it('counts what waits and what keeps running before the user goes', () => {
    const evening = { ...FACTS, kind: 'before-you-go' as const, hour: 18, waiting: 1, working: 2 };
    expect(headline(SAM, evening)).toBe(
      'Before you go, 1 thing needs you and 2 agents are working.',
    );
    expect(headline({ personality: 'facts', name: 'Sam' }, { ...evening, waiting: 0 })).toBe(
      'Before you go: 2 agents are working.',
    );
  });
});

describe('headlineMood', () => {
  it('reflects the lead and falls back on the board', () => {
    expect(headlineMood({ ...FACTS, kind: 'meeting' }, null)).toBe('alert');
    expect(headlineMood({ ...FACTS, kind: 'since-you-left', failed: 1 }, null)).toBe('sad');
    expect(headlineMood({ ...FACTS, kind: 'since-you-left' }, null)).toBe('happy');
    expect(headlineMood({ ...FACTS, kind: 'before-you-go', waiting: 1 }, null)).toBe('alert');
    expect(headlineMood({ ...FACTS, kind: 'before-you-go' }, null)).toBe('working');
    expect(headlineMood(FACTS, 'sleep')).toBe('sleep');
  });
});
