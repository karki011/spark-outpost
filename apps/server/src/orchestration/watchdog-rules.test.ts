import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WATCH_SETTINGS,
  dueCheck,
  flagLines,
  markChecked,
  newCounters,
  nudgeText,
  remember,
  repeatFlags,
  ruleVerdict,
  watchAction,
  watchSummary,
  watchVerdict,
  withNudge,
  WATCH_RECENT,
  type ToolCall,
  type WatchVerdict,
} from './watchdog-rules.ts';

const read = (file: string): ToolCall => ({ title: `Read \`${file}\``, kind: 'read' });
const run = (command: string): ToolCall => ({ title: `Run \`${command}\``, kind: 'execute' });
const edit = (file: string): ToolCall => ({ title: `Edit ${file}`, kind: 'edit' });
const times = (call: ToolCall, count: number) => Array.from({ length: count }, () => call);

const stuck: WatchVerdict = { stuck: true, reason: 'repeating', source: 'jev', noul: 0.93 };
const fine: WatchVerdict = { stuck: false, reason: null, source: 'jev', noul: 0.05 };
const context = {
  level: 'balanced' as const,
  checksSinceAction: null,
  asking: false,
  memberEnded: false,
};

describe('watchdog repeat heuristics', () => {
  it('counts an identical tail, the most frequent call and a back-and-forth', () => {
    const flags = repeatFlags([read('a.ts'), ...times(run('pnpm test'), 4)]);
    expect(flags).toMatchObject({
      streak: 4,
      streakTitle: 'Run `pnpm test`',
      streakKind: 'execute',
      topCount: 4,
      alternating: false,
    });
    const pingPong = [
      read('a.ts'),
      read('b.ts'),
      read('a.ts'),
      read('b.ts'),
      read('a.ts'),
      read('b.ts'),
    ];
    expect(repeatFlags(pingPong)).toMatchObject({ streak: 1, alternating: true, topCount: 3 });
    expect(repeatFlags([])).toMatchObject({ streak: 0, streakTitle: null, topCount: 0 });
  });

  it('only calls five identical non-edit calls in a row stuck by rule', () => {
    expect(ruleVerdict(repeatFlags(times(read('a.ts'), 5)))).toMatchObject({
      stuck: true,
      reason: 'repeating',
    });
    expect(ruleVerdict(repeatFlags(times(read('a.ts'), 4))).stuck).toBe(false);
    expect(ruleVerdict(repeatFlags(times(edit('a.ts'), 8))).stuck).toBe(false);
    const fixLoop = [edit('a.ts'), run('pnpm test'), edit('a.ts'), run('pnpm test')];
    expect(ruleVerdict(repeatFlags(fixLoop)).stuck).toBe(false);
  });

  it('turns the flags into named buckets for Jev', () => {
    expect(flagLines(repeatFlags(times(read('a.ts'), 4)), 'silence')).toEqual([
      'the last call was repeated three or more times in a row',
      'one call makes up a third or more of the recent calls',
      'no output for over two minutes',
    ]);
    expect(flagLines(repeatFlags([read('a.ts'), read('b.ts')]), 'tool_calls')).toEqual([]);
  });

  it('keeps only the most recent calls', () => {
    const recent: ToolCall[] = [];
    for (let index = 0; index < WATCH_RECENT + 5; index += 1) remember(recent, read(`${index}.ts`));
    expect(recent).toHaveLength(WATCH_RECENT);
    expect(recent[0]).toEqual(read('5.ts'));
  });
});

describe('when the watchdog checks', () => {
  const settings = { ...DEFAULT_WATCH_SETTINGS, everyToolCalls: 10, silenceMs: 1_000 };

  it('checks every ten tool calls and once per silence, never while a check is in flight', () => {
    const counters = newCounters(0);
    counters.toolCalls = 9;
    expect(dueCheck(counters, 10, settings)).toBeNull();
    counters.toolCalls = 10;
    expect(dueCheck(counters, 10, settings)).toBe('tool_calls');
    markChecked(counters, 'tool_calls');
    expect(dueCheck(counters, 10, settings)).toBeNull();
    counters.inFlight = false;
    expect(dueCheck(counters, 999, settings)).toBeNull();
    expect(dueCheck(counters, 1_000, settings)).toBe('silence');
    markChecked(counters, 'silence');
    counters.inFlight = false;
    expect(dueCheck(counters, 5_000, settings)).toBeNull();
    counters.lastOutputAt = 5_000;
    expect(dueCheck(counters, 6_000, settings)).toBe('silence');
    counters.toolCalls = 19;
    expect(dueCheck(counters, 5_001, settings)).toBeNull();
    counters.toolCalls = 20;
    expect(dueCheck(counters, 5_001, settings)).toBe('tool_calls');
  });
});

describe('watchdog verdict', () => {
  const ruleStuck = {
    stuck: true,
    reason: 'repeating' as const,
    note: '5 identical calls in a row',
  };
  const ruleFine = { stuck: false, reason: null, note: 'no obvious repeat' };
  const answers = (reason: 'repeating' | 'waiting', noul: number) => ({
    nouls: { [reason]: noul },
    worst: { reason, noul },
  });

  it('lets a sure Jev decide either way and the rule decide otherwise', () => {
    expect(watchVerdict(answers('waiting', 0.9), ruleFine)).toEqual({
      stuck: true,
      reason: 'waiting',
      source: 'jev',
      noul: 0.9,
    });
    expect(watchVerdict(answers('repeating', 0.1), ruleStuck)).toMatchObject({
      stuck: false,
      source: 'jev',
    });
    expect(watchVerdict(answers('repeating', 0.6), ruleStuck)).toMatchObject({
      stuck: true,
      source: 'rules',
      noul: 0.6,
    });
    expect(watchVerdict(null, ruleFine)).toMatchObject({
      stuck: false,
      source: 'rules',
      noul: null,
    });
  });
});

describe('watchdog action by level', () => {
  it('asks at Hands-on and Balanced, nudges at Hands-off and Full auto, never stops', () => {
    expect(watchAction(stuck, { ...context, level: 'hands-on' })).toBe('checkpoint');
    expect(watchAction(stuck, context)).toBe('checkpoint');
    expect(watchAction(stuck, { ...context, level: 'hands-off' })).toBe('nudge');
    expect(watchAction(stuck, { ...context, level: 'full-auto' })).toBe('nudge');
    expect(watchAction(fine, context)).toBe('none');
  });

  it('holds while another watchdog question is open or right after acting', () => {
    expect(watchAction(stuck, { ...context, asking: true })).toBe('held');
    expect(watchAction(stuck, { ...context, level: 'full-auto', asking: true })).toBe('nudge');
    expect(watchAction(stuck, { ...context, checksSinceAction: 1 })).toBe('held');
    expect(watchAction(stuck, { ...context, checksSinceAction: 2 })).toBe('checkpoint');
    expect(watchAction(stuck, { ...context, memberEnded: true })).toBe('none');
  });
});

describe('watchdog words', () => {
  it('writes a fixed nudge per reason and adds it to the next turn', () => {
    const flags = repeatFlags(times(read('src/a.ts'), 4));
    expect(nudgeText('repeating', flags)).toBe(
      'You seemed to be repeating Read src/a.ts. Step back: say what is blocking you, then try a different approach, or stop and report what you found.',
    );
    expect(nudgeText('finished', flags)).toContain('stop now');
    expect(withNudge('Continue with step 2.', 'Stop repeating.')).toBe(
      'Continue with step 2.\n\n## Note from the harness\nStop repeating.',
    );
  });

  it('summarises what Jev said next to what the rule would have done', () => {
    const flags = repeatFlags(times(read('a.ts'), 5));
    const rule = ruleVerdict(flags);
    expect(watchSummary('Bolt', stuck, 'checkpoint', rule, flags)).toBe(
      'Bolt looks stuck: repeating Read a.ts · asked you (Jev 0.93; rule: stuck, 5 identical calls in a row)',
    );
    expect(watchSummary('Bolt', fine, 'none', ruleVerdict(repeatFlags([])), repeatFlags([]))).toBe(
      'Bolt looks fine (Jev 0.05; rule: fine, no obvious repeat)',
    );
  });
});
