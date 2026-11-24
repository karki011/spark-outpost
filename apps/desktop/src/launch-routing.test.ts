import { describe, expect, it, vi } from 'vitest';
import { createLaunchRouting } from './launch-routing.ts';

const CHAT = '3f0c9a52-6f0e-4d53-9a35-0d1f5a4b7c11';
const EXE = 'C:\\Spark Outpost.exe';
const LINK = `spark-outpost://chat/${CHAT}`;

function setup(argv: readonly string[] = [EXE], platform: NodeJS.Platform = 'win32') {
  const showSpark = vi.fn();
  const slackCallback = vi.fn();
  const routing = createLaunchRouting({
    scheme: 'spark-outpost',
    argv,
    platform,
    showSpark,
    slackCallback,
    isSlackCallback: (url) => url.startsWith('spark-outpost://slack'),
  });
  const targets = { openChat: vi.fn(), runJumpTask: vi.fn() };
  return { routing, targets, showSpark, slackCallback };
}

describe('launch routing', () => {
  it('holds a jump task clicked while Spark starts and runs it once the companion is ready', () => {
    const { routing, targets } = setup();
    routing.secondInstance([EXE, '--spark-task=lock']);
    expect(targets.runJumpTask).not.toHaveBeenCalled();
    routing.ready(targets);
    expect(targets.runJumpTask).toHaveBeenCalledTimes(1);
    expect(targets.runJumpTask).toHaveBeenCalledWith('lock');
    routing.ready(targets);
    expect(targets.runJumpTask).toHaveBeenCalledTimes(1);
  });

  it('runs held tasks in the order they were clicked, after the launch task', () => {
    const { routing, targets } = setup([EXE, '--spark-task=hide-island']);
    routing.secondInstance([EXE, '--spark-task=show-island']);
    routing.secondInstance([EXE, '--spark-task=lock']);
    routing.ready(targets);
    expect(targets.runJumpTask.mock.calls).toEqual([['hide-island'], ['show-island'], ['lock']]);
  });

  it('runs a task at once when the companion is ready', () => {
    const { routing, targets } = setup();
    routing.ready(targets);
    routing.secondInstance([EXE, '--spark-task=show-island']);
    expect(targets.runJumpTask).toHaveBeenCalledWith('show-island');
  });

  it('holds tasks again after the companion stops', () => {
    const { routing, targets } = setup();
    routing.ready(targets);
    routing.stopped();
    routing.secondInstance([EXE, '--spark-task=lock']);
    expect(targets.runJumpTask).not.toHaveBeenCalled();
  });

  it('ignores task arguments off Windows', () => {
    const { routing, targets, showSpark } = setup(
      ['/Applications/Spark', '--spark-task=lock'],
      'darwin',
    );
    routing.ready(targets);
    routing.secondInstance(['/Applications/Spark', '--spark-task=lock']);
    expect(targets.runJumpTask).not.toHaveBeenCalled();
    expect(showSpark).toHaveBeenCalledTimes(1);
  });

  it('opens a launch chat link once ready and a later link at once', () => {
    const { routing, targets } = setup([EXE, LINK]);
    routing.ready(targets);
    expect(targets.openChat).toHaveBeenCalledWith(CHAT);
    routing.secondInstance([EXE, LINK]);
    expect(targets.openChat).toHaveBeenCalledTimes(2);
    expect(targets.runJumpTask).not.toHaveBeenCalled();
  });

  it('holds a chat link that arrives before the companion is ready', () => {
    const { routing, targets } = setup();
    routing.openLink(LINK);
    expect(targets.openChat).not.toHaveBeenCalled();
    routing.ready(targets);
    expect(targets.openChat).toHaveBeenCalledWith(CHAT);
  });

  it('shows Spark for a second launch with no link and hands Slack callbacks on', () => {
    const { routing, targets, showSpark, slackCallback } = setup();
    routing.ready(targets);
    routing.secondInstance([EXE]);
    expect(showSpark).toHaveBeenCalledTimes(1);
    routing.openLink('spark-outpost://slack/callback?code=x');
    expect(slackCallback).toHaveBeenCalledWith('spark-outpost://slack/callback?code=x');
    expect(showSpark).toHaveBeenCalledTimes(2);
  });
});
