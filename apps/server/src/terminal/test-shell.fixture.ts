import { defaultShell } from '../setup/default-shell.ts';

export const TEST_SHELL = process.platform === 'win32' ? defaultShell() : '/bin/sh';

export function shellPid(variable: '$$'): string {
  return process.platform === 'win32' ? `$(cat /proc/${variable}/winpid)` : variable;
}

export function backgroundPid(program: string): string {
  if (process.platform !== 'win32') return '$!';
  const waitForExec = `for i in $(seq 100); do case "$(cat /proc/$!/exename 2>/dev/null)" in */${program}) break;; esac; sleep 0.1; done`;
  return `$(${waitForExec}; cat /proc/$!/winpid)`;
}
