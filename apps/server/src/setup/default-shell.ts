import { existsSync } from 'node:fs';
import path from 'node:path';

const GIT_BASH = path.win32.join('Git', 'bin', 'bash.exe');

export function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const configured = env.CLAUDE_CODE_GIT_BASH_PATH?.trim();
  const local = env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs') : undefined;
  const installs = [env.ProgramFiles, env['ProgramFiles(x86)'], local]
    .filter((root): root is string => Boolean(root?.trim()))
    .map((root) => path.win32.join(root, GIT_BASH));
  return [...(configured ? [configured] : []), ...installs];
}

export function defaultShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = existsSync,
): string {
  if (platform !== 'win32') return env.SHELL || '/bin/zsh';
  const candidates = gitBashCandidates(env);
  return (
    candidates.find((candidate) => exists(candidate)) ??
    path.win32.join('C:\\Program Files', GIT_BASH)
  );
}
