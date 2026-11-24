import type { Task } from 'electron';
import { JUMP_TASK_FLAG, type JumpTask } from './deep-link.ts';
import type { TrayState } from './island-options.ts';

export interface JumpLaunch {
  program: string;
  leadingArgs: readonly string[];
}

export function windowsArg(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function task(launch: JumpLaunch, jump: JumpTask, title: string, description: string): Task {
  return {
    program: launch.program,
    arguments: [...launch.leadingArgs, `${JUMP_TASK_FLAG}${jump}`].map(windowsArg).join(' '),
    title,
    description,
    iconPath: launch.program,
    iconIndex: 0,
  };
}

export function jumpListTasks(state: TrayState, launch: JumpLaunch): Task[] {
  const tasks: Task[] = [];
  if (state.supported) {
    tasks.push(
      state.companionOn
        ? task(launch, 'hide-island', 'Hide Spark Island', 'Hide Spark Island')
        : task(launch, 'show-island', 'Show Spark Island', 'Show Spark Island'),
    );
  }
  if (state.lockAvailable) {
    tasks.push(task(launch, 'lock', 'Lock Spark Outpost', 'Lock Spark Outpost'));
  }
  return tasks;
}
