import { execFile } from 'node:child_process';
import { childEnvironment } from './environment.ts';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type RunCommand = (
  file: string,
  args: string[],
  timeoutMs: number,
) => Promise<CommandResult>;

export const runCommand: RunCommand = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, env: childEnvironment(process.env) },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
        resolve({
          code,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: error?.killed === true,
        });
      },
    );
    child.stdin?.end();
  });
