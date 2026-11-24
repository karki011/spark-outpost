import { describe, expect, it } from 'vitest';
import { jumpTaskIn } from './deep-link.ts';
import { jumpListTasks, windowsArg } from './jump-list.ts';

const PACKAGED = {
  program: 'C:\\Program Files\\Spark Outpost\\Spark Outpost.exe',
  leadingArgs: [],
};
const STATE = {
  appName: 'Spark Outpost',
  companionOn: false,
  supported: true,
  lockAvailable: true,
};

describe('jump list', () => {
  it('offers the Dock menu items as tasks that relaunch the app with a task argument', () => {
    const tasks = jumpListTasks(STATE, PACKAGED);
    expect(tasks.map((task) => task.title)).toEqual(['Show Spark Island', 'Lock Spark Outpost']);
    expect(tasks[0]).toMatchObject({
      program: PACKAGED.program,
      arguments: '--spark-task=show-island',
      iconPath: PACKAGED.program,
      iconIndex: 0,
    });
    expect(tasks[1]?.arguments).toBe('--spark-task=lock');
  });

  it('names the island task after what it will do, since a jump list has no checkmarks', () => {
    const tasks = jumpListTasks({ ...STATE, companionOn: true }, PACKAGED);
    expect(tasks[0]).toMatchObject({
      title: 'Hide Spark Island',
      arguments: '--spark-task=hide-island',
    });
  });

  it('leaves out the island when unsupported and Lock while the privacy screen is off', () => {
    expect(jumpListTasks({ ...STATE, supported: false, lockAvailable: false }, PACKAGED)).toEqual(
      [],
    );
  });

  it('passes the app folder first when running from source, quoted when it has spaces', () => {
    const [task] = jumpListTasks(STATE, {
      program: 'C:\\dev\\electron.exe',
      leadingArgs: ['C:\\My Code\\spark\\apps\\desktop'],
    });
    expect(task?.arguments).toBe('"C:\\My Code\\spark\\apps\\desktop" --spark-task=show-island');
  });

  it('quotes only arguments that need it', () => {
    expect(windowsArg('--flag')).toBe('--flag');
    expect(windowsArg('a b')).toBe('"a b"');
    expect(windowsArg('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('jump list task arguments', () => {
  it('reads a known task from the arguments on Windows', () => {
    expect(jumpTaskIn(['Spark.exe', '--spark-task=lock'], 'win32')).toBe('lock');
    expect(jumpTaskIn(['Spark.exe', 'app', '--spark-task=show-island'], 'win32')).toBe(
      'show-island',
    );
    expect(jumpTaskIn(['Spark.exe', '--spark-task=hide-island'], 'win32')).toBe('hide-island');
  });

  it('ignores unknown tasks, missing tasks and every other platform', () => {
    expect(jumpTaskIn(['Spark.exe', '--spark-task=quit'], 'win32')).toBeNull();
    expect(jumpTaskIn(['Spark.exe'], 'win32')).toBeNull();
    expect(jumpTaskIn(['Spark', '--spark-task=lock'], 'darwin')).toBeNull();
  });
});
