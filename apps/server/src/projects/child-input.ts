import type { ChildProcess } from 'node:child_process';

/**
 * Ends the child's stdin with the input, if stdin is available. Stream errors
 * are ignored; callers must observe the child separately for its exit status.
 */
export function sendInput(child: ChildProcess, input: string): void {
  child.stdin?.on('error', () => undefined);
  child.stdin?.end(input);
}
