import { existsSync } from 'node:fs';
import { gitBashCandidates } from '../setup/default-shell.ts';
import type { NativeProvider } from './native-hooks.ts';

export interface HookCommandInput {
  provider: NativeProvider;
  platform: NodeJS.Platform;
  execPath: string;
  script: string;
  credentials: string;
}

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE=1';

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function cmdQuote(value: string): string {
  if (value.includes('"')) throw new Error('A hook path cannot hold a double quote.');
  return `"${value}"`;
}

export function nativeHookCommand(input: HookCommandInput): string {
  const program = [input.execPath, input.script, input.credentials];
  if (input.platform !== 'win32')
    return ['/usr/bin/env', RUN_AS_NODE, ...program].map(shellQuote).join(' ');
  if (input.provider === 'codex')
    return `set "${RUN_AS_NODE}" && ${program.map(cmdQuote).join(' ')}`;
  return [RUN_AS_NODE, ...program.map((part) => shellQuote(part.replaceAll('\\', '/')))].join(' ');
}

export function claudeGitBashEnv(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = existsSync,
): Record<string, string> {
  if (platform !== 'win32' || env.CLAUDE_CODE_GIT_BASH_PATH?.trim()) return {};
  const found = gitBashCandidates(env).find((candidate) => exists(candidate));
  return found ? { CLAUDE_CODE_GIT_BASH_PATH: found } : {};
}
