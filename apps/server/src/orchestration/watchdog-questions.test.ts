import { describe, expect, it } from 'vitest';
import { buildWatchdogQuestions, parseWatchdog, type WatchFacts } from './watchdog-questions.ts';

const facts: WatchFacts = {
  role: 'builder',
  steps: ['Add the parser in src/parse.ts', 'Test it in src/parse.test.ts'],
  ticked: 0,
  recent: [
    { title: 'Read `src/parse.ts`', kind: 'read' },
    { title: 'Run `curl -H "Authorization: Bearer abcdef0123456789" api`', kind: 'execute' },
  ],
  flags: ['two calls alternate back and forth'],
  trigger: 'tool_calls',
};

describe('watchdog questions', () => {
  it('pins the state keys and asks four bad-is-true nouls', () => {
    const asked = buildWatchdogQuestions(facts);
    expect(Object.keys(asked.state)).toEqual([
      'role',
      'work',
      'progress',
      'recent',
      'flags',
      'trigger',
    ]);
    expect(Object.keys(asked.questions)).toEqual(['repeating', 'off_step', 'waiting', 'finished']);
    for (const question of Object.values(asked.questions)) {
      expect(question.type).toBe('noul');
      expect(Object.keys(question.criteria as object)).toEqual(['true', 'false']);
    }
    expect(asked.questions.repeating!.instructions).toBe(
      'Is the agent repeating the same actions in `recent` without making progress on `work`?',
    );
  });

  it('sends step text and tool-call titles with file paths, but never secrets', () => {
    const asked = buildWatchdogQuestions(facts);
    expect(asked.state).toMatchObject({
      role: 'Builder',
      work: ['Add the parser in src/parse.ts', 'Test it in src/parse.test.ts'],
      progress: 'no step marked done yet',
      trigger: 'every ten tool calls',
    });
    const recent = asked.state.recent as string[];
    expect(recent[0]).toBe('read: Read `src/parse.ts`');
    expect(recent[1]).not.toContain('abcdef0123456789');
  });

  it('describes the role when there is no step, and a long silence', () => {
    const asked = buildWatchdogQuestions({
      ...facts,
      role: 'critic',
      steps: [],
      trigger: 'silence',
    });
    expect(asked.state).toMatchObject({
      role: 'Critic',
      work: ['Review a change and list findings; change nothing'],
      progress: null,
      trigger: 'long silence',
    });
  });

  it('parses the nouls and picks the worst one', () => {
    const noul = (value: number) => ({ type: 'noul' as const, noul: value });
    const parsed = parseWatchdog({
      model: 'jev-1.13.0',
      answers: {
        repeating: noul(0.2),
        off_step: noul(0.1),
        waiting: noul(0.88),
        finished: noul(0.4),
      },
    });
    expect(parsed).toEqual({
      nouls: { repeating: 0.2, off_step: 0.1, waiting: 0.88, finished: 0.4 },
      worst: { reason: 'waiting', noul: 0.88 },
    });
    expect(parseWatchdog({ model: 'jev-1.13.0', answers: {} })).toBeNull();
  });
});
