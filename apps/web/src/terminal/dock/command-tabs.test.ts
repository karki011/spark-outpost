import { describe, expect, it } from 'vitest';
import type { CommandRun } from '@spark-outpost/contracts';
import type { CommandView, LiveCommand } from '../../chat/commands/command-model.ts';
import {
  commandTabLabel,
  findCommandTab,
  isSettled,
  mirrorBody,
  mirroredCommand,
  mirrorEnding,
  mirrorFolder,
  mirrorStatus,
  needsSavedOutput,
} from './command-tabs.ts';

const RUN = '01990000-0000-7000-8000-0000000000aa';
const OTHER_RUN = '01990000-0000-7000-8000-0000000000bb';
const ID = '01990000-0000-7000-8000-000000000001';
const mirror = { runId: RUN, commandId: ID };

const saved = (change: Partial<CommandRun> = {}): CommandRun => ({
  id: ID,
  runId: RUN,
  command: 'pnpm dev',
  cwd: '/Users/me/widgets',
  live: true,
  startedAt: '2026-10-09T10:00:00.000Z',
  textOffset: null,
  textBefore: null,
  textHeld: null,
  status: 'completed',
  exitCode: 0,
  finishedAt: '2026-10-09T10:00:03.000Z',
  outputChars: 12,
  ...change,
});

const streamed = (change: Partial<LiveCommand> = {}): LiveCommand => ({
  ...saved({ status: 'running', exitCode: null, finishedAt: null }),
  output: 'ready\n',
  received: 6,
  appended: 6,
  epoch: 0,
  ...change,
});

const view = (change: Partial<CommandView> = {}): CommandView => ({
  ...streamed(),
  runId: RUN,
  ...change,
});

describe('finding a mirror tab', () => {
  it('matches one tab per run and command', () => {
    const tabs = [
      { id: 'shell', mirror: null },
      { id: 'other', mirror: { runId: OTHER_RUN, commandId: ID } },
      { id: 'mine', mirror },
    ];
    expect(findCommandTab(tabs, mirror)?.id).toBe('mine');
    expect(findCommandTab(tabs.slice(0, 2), mirror)).toBeNull();
  });
});

describe('the mirrored command', () => {
  it('is the streamed command while it runs', () => {
    const command = mirroredCommand([], [streamed()], mirror);
    expect(command).toMatchObject({ runId: RUN, status: 'running', output: 'ready\n' });
  });

  it('keeps the streamed output once the saved row says how it ended', () => {
    const command = mirroredCommand([saved()], [streamed()], mirror);
    expect(command).toMatchObject({ status: 'completed', exitCode: 0, output: 'ready\n' });
  });

  it('is the saved row with no output yet when nothing was streamed', () => {
    const command = mirroredCommand([saved()], [], mirror);
    expect(command?.output).toBeNull();
    expect(needsSavedOutput(command)).toBe(true);
    expect(needsSavedOutput(mirroredCommand([], [streamed()], mirror))).toBe(false);
  });

  it('ignores other commands and other runs', () => {
    const others = [saved({ id: '01990000-0000-7000-8000-000000000002' })];
    expect(mirroredCommand(others, [], mirror)).toBeNull();
    expect(mirroredCommand([saved({ runId: OTHER_RUN })], [], mirror)).toBeNull();
    expect(needsSavedOutput(null)).toBe(false);
  });

  it('is settled only when the saved row has ended', () => {
    expect(isSettled(undefined, mirror)).toBe(false);
    expect(isSettled([saved({ status: 'running' })], mirror)).toBe(false);
    expect(isSettled([saved({ status: 'interrupted' })], mirror)).toBe(true);
  });
});

describe('what the tab says', () => {
  it('labels the tab with the agent and a short one-line command', () => {
    expect(commandTabLabel('Claude', 'pnpm dev')).toBe('Claude · pnpm dev');
    expect(commandTabLabel(null, 'vitest  --watch\n')).toBe('Agent · vitest --watch');
    const long = commandTabLabel('Codex', `pnpm test ${'x'.repeat(60)}`);
    expect(long).toBe(`Codex · pnpm test ${'x'.repeat(21)}…`);
  });

  it('shows the folder the chat works in instead of a project-relative one', () => {
    expect(mirrorFolder('./', '/Users/me/widgets')).toBe('/Users/me/widgets');
    expect(mirrorFolder('./apps/web', '/Users/me/widgets/')).toBe('/Users/me/widgets/apps/web');
    expect(mirrorFolder('./', null)).toBe('./');
    expect(mirrorFolder('~/notes', '/Users/me/widgets')).toBe('~/notes');
    expect(mirrorFolder('/tmp/build', '/Users/me/widgets')).toBe('/tmp/build');
    expect(mirrorFolder(null, '/Users/me/widgets')).toBeNull();
  });

  it('lights the tab while the command runs', () => {
    expect(mirrorStatus(null, true)).toBe('starting');
    expect(mirrorStatus(null, false)).toBe('ended');
    expect(mirrorStatus(view(), false)).toBe('open');
    expect(mirrorStatus(view({ status: 'failed' }), true)).toBe('ended');
  });

  it('picks the body for each state', () => {
    expect(mirrorBody(null, null, true)).toBe('finding');
    expect(mirrorBody(null, null, false)).toBe('missing');
    expect(mirrorBody(view({ live: false, output: '' }), '', false)).toBe('awaits-end');
    expect(mirrorBody(view({ output: '' }), '', false)).toBe('screen');
    expect(mirrorBody(view({ status: 'completed', output: null }), null, false)).toBe('loading');
    expect(mirrorBody(view({ status: 'completed', output: '' }), '', false)).toBe('empty');
    expect(mirrorBody(view({ status: 'completed' }), 'ready\n', false)).toBe('screen');
  });

  it('says how the command ended', () => {
    expect(mirrorEnding(view({ status: 'completed', exitCode: 0 }), 'ok')).toBe(
      'Finished, exit code 0.',
    );
    expect(mirrorEnding(view({ status: 'failed', exitCode: 2 }), 'no')).toBe(
      'Failed, exit code 2.',
    );
    expect(mirrorEnding(view({ status: 'interrupted' }), 'ready')).toBe(
      'Interrupted before it finished. This is what was captured.',
    );
    expect(mirrorEnding(view({ status: 'interrupted' }), '')).toBe(
      'Interrupted before it finished. No output was captured.',
    );
  });
});
