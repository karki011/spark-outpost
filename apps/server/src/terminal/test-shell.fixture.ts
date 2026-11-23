import { defaultShell } from '../setup/default-shell.ts';

export const TEST_SHELL = process.platform === 'win32' ? defaultShell() : '/bin/sh';

export function shellPid(variable: '$$' | '$!'): string {
  return process.platform === 'win32' ? `$(sleep 1; cat /proc/${variable}/winpid)` : variable;
}
