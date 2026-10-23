import { describe, expect, it } from 'vitest';
import {
  COMMAND_BROWSER_CHARS,
  COMMAND_DESCRIBED,
  COMMAND_FINISHED,
  COMMAND_OUTPUT,
  COMMAND_STARTED,
  type CommandRun,
} from '@spark-outpost/contracts';
import {
  applyCommandEvent,
  commandOutcome,
  runCommands,
  shownCommands,
  shownDuration,
  type LiveCommand,
} from './command-model.ts';

const ID = '01990000-0000-7000-8000-000000000001';
const RUN = '01990000-0000-7000-8000-0000000000aa';

const started = {
  name: COMMAND_STARTED,
  value: {
    id: ID,
    command: 'pnpm test',
    cwd: './',
    live: true,
    startedAt: '2026-10-06T10:00:00.000Z',
    textOffset: 12,
    textBefore: 'Running now.',
    textHeld: 0,
  },
};

const output = (at: number, chunk: string, reset = false) => ({
  name: COMMAND_OUTPUT,
  value: { id: ID, at, chunk, ...(reset ? { reset } : {}) },
});

const finished = (status: string, exitCode: number | null) => ({
  name: COMMAND_FINISHED,
  value: { id: ID, status, exitCode, finishedAt: '2026-10-06T10:00:05.000Z', outputChars: 9 },
});

function play(...events: { name: string; value?: unknown }[]): readonly LiveCommand[] {
  return events.reduce<readonly LiveCommand[]>(applyCommandEvent, []);
}

describe('applyCommandEvent', () => {
  it('starts a running command once', () => {
    const commands = play(started, started);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ status: 'running', output: '', received: 0 });
  });

  it("takes the agent's description when it arrives after the command started", () => {
    const described = { name: COMMAND_DESCRIBED, value: { id: ID, description: 'Run the tests' } };
    const [command] = play(started, described, finished('completed', 0));
    expect(command).toMatchObject({ description: 'Run the tests', status: 'completed' });
    expect(play(described)).toEqual([]);
  });

  it('appends chunks in order', () => {
    const [command] = play(started, output(0, 'one\n'), output(4, 'two\n'));
    expect(command).toMatchObject({ output: 'one\ntwo\n', received: 8, appended: 8, epoch: 0 });
  });

  it('ignores a chunk it has already applied', () => {
    const [command] = play(started, output(0, 'one\n'), output(0, 'one\n'), output(4, 'two\n'));
    expect(command!.output).toBe('one\ntwo\n');
  });

  it('keeps only the new part of a chunk that overlaps', () => {
    const [command] = play(started, output(0, 'one\n'), output(2, 'e\ntwo\n'));
    expect(command!.output).toBe('one\ntwo\n');
  });

  it('marks output it never received instead of joining across the gap', () => {
    const [command] = play(started, output(0, 'one\n'), output(5000, 'late\n'));
    expect(command!.output).toBe('one\n\n[… 4,996 characters not shown …]\nlate\n');
    expect(command!.received).toBe(5005);
  });

  it('replaces everything on a reset and tells the screen to redraw', () => {
    const [command] = play(started, output(0, 'one\n'), output(90, 'the end\n', true));
    expect(command).toMatchObject({ output: 'the end\n', received: 98, epoch: 1 });
  });

  it('keeps only the newest output in the browser', () => {
    const line = `${'x'.repeat(99)}\n`;
    const events = Array.from({ length: 3000 }, (_, row) => output(row * 100, line));
    const [command] = play(started, ...events);
    expect(command!.output!.length).toBeLessThanOrEqual(COMMAND_BROWSER_CHARS);
    expect(command!.received).toBe(300_000);
    expect(command!.appended).toBe(300_000);
  });

  it('records the end and then ignores late output', () => {
    const [command] = play(started, output(0, 'one\n'), finished('failed', 2), output(4, 'x'));
    expect(command).toMatchObject({ status: 'failed', exitCode: 2, output: 'one\n' });
    expect(commandOutcome(command!)).toBe('Failed, exit code 2');
  });

  it('ignores events for commands it has not seen and malformed values', () => {
    expect(play(output(0, 'one\n'), finished('completed', 0))).toEqual([]);
    expect(play(started, { name: COMMAND_OUTPUT, value: { id: ID, at: -1, chunk: 3 } })).toEqual(
      play(started),
    );
  });
});

const saved: CommandRun = {
  ...started.value,
  runId: RUN,
  status: 'interrupted',
  exitCode: null,
  finishedAt: '2026-10-06T10:00:09.000Z',
  outputChars: 4,
};

describe('shownCommands', () => {
  it('shows a stored command without output until it is loaded', () => {
    expect(shownCommands([saved], [], RUN)).toEqual([
      { ...saved, output: null, received: 0, appended: 0, epoch: 0 },
    ]);
  });

  it('keeps the streamed output when the stored record takes over', () => {
    const [command] = shownCommands([saved], play(started, output(0, 'one\n')), RUN);
    expect(command).toMatchObject({ status: 'interrupted', output: 'one\n', runId: RUN });
  });

  it('prefers the stream while the stored record still says running', () => {
    const live = play(started, output(0, 'one\n'), finished('completed', 0));
    const [command] = shownCommands([{ ...saved, status: 'running' }], live, RUN);
    expect(command).toMatchObject({ status: 'completed', exitCode: 0 });
  });

  it('adds streamed commands the stored list does not have yet', () => {
    expect(shownCommands([], play(started), RUN)[0]).toMatchObject({ id: ID, runId: RUN });
  });
});

describe('runCommands', () => {
  it('keeps the commands of the given runs', () => {
    expect(runCommands([saved], [null, RUN])).toEqual([saved]);
    expect(runCommands([saved], ['other'])).toEqual([]);
    expect(runCommands(undefined, [RUN])).toEqual([]);
  });
});

describe('shownDuration', () => {
  it('shows seconds, then minutes and seconds', () => {
    expect(shownDuration(9)).toBe('9s');
    expect(shownDuration(125)).toBe('2m 05s');
  });
});
