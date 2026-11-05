import type { ChildProcess } from 'node:child_process';

export function sendInput(child: ChildProcess, input: string): void {
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(input);
}
