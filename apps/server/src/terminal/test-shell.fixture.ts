import { defaultShell } from '../setup/default-shell.ts';

export const TEST_SHELL = process.platform === 'win32' ? defaultShell() : '/bin/sh';
