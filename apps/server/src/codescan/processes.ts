import { spawn } from 'node:child_process';
import { constants, setPriority } from 'node:os';

export const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface RunOptions {
  cwd: string;
  signal?: AbortSignal;
  okCodes?: readonly number[];
  maxBytes?: number;
  onStdout?: (chunk: Buffer) => void;
}

export class CommandError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null) {
    super(message);
    this.code = code;
  }
}

function lowerPriority(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    return;
  }
}

export function runCommand(command: string, args: string[], options: RunOptions): Promise<string> {
  const okCodes = options.okCodes ?? [0];
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {}),
    });
    lowerPriority(child.pid);
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) child.kill();
      else if (options.onStdout) options.onStdout(chunk);
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-2000);
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== null && okCodes.includes(code)) {
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      const reason = stderr.trim() || `exit code ${code}`;
      reject(new CommandError(`${command} ${args[0] ?? ''} failed: ${reason}`, code));
    });
  });
}
