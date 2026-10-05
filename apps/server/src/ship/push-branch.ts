import { redactText } from '../audit/redact.ts';
import { childEnvironment, withoutValues } from '../setup/environment.ts';
import { ShipGitError, type GitAccess } from './git.ts';
import { PUSH_TIMEOUT_MS, runPush, type PushEnd, type PushRun } from './push-run.ts';

const OUTPUT_LINES = 40;

export class PushStoppedError extends ShipGitError {
  readonly ended: Exclude<PushEnd, 'exited'>;

  constructor(message: string, output: string, ended: Exclude<PushEnd, 'exited'>) {
    super(message, output);
    this.ended = ended;
  }
}

function pushOutput(run: PushRun, hidden: readonly string[]): string {
  return withoutValues(redactText(run.output.trim()), hidden)
    .split('\n')
    .slice(-OUTPUT_LINES)
    .join('\n');
}

export async function pushBranch(
  root: string,
  remote: string,
  branch: string,
  access: GitAccess = {},
): Promise<string> {
  const ref = `refs/heads/${branch}`;
  const run = await runPush(
    root,
    [...(access.config ?? []), 'push', '--set-upstream', remote, `${ref}:${ref}`],
    {
      env: {
        ...childEnvironment(process.env),
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
        ...access.env,
      },
      timeoutMs: access.timeoutMs,
      signal: access.signal,
    },
  );
  const output = pushOutput(run, access.hidden ?? []);
  if (run.ended === 'cancelled') {
    throw new PushStoppedError(`Pushing ${branch} was cancelled.`, output, 'cancelled');
  }
  if (run.ended === 'timed_out') {
    const minutes = Math.round((access.timeoutMs ?? PUSH_TIMEOUT_MS) / 60_000);
    throw new PushStoppedError(
      `Pushing ${branch} was stopped after ${minutes} minutes without finishing; a pre-push check may be waiting for input.`,
      output,
      'timed_out',
    );
  }
  if (run.code !== 0) {
    const detail = output.split('\n').slice(-6).join(' ').trim();
    throw new ShipGitError(
      `Pushing ${branch} failed: ${detail || `git exited ${run.code}`}`,
      output,
    );
  }
  return output;
}
