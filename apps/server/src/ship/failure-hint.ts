import { ShipGitError } from './git.ts';
import { GitHubApiError } from './github/connection.ts';
import { GIT_AUTH } from './push.ts';

const PROTECTED = /protected branch|GH006|pre-receive hook declined|push declined/i;
const PUSH_HOOK = /pre-push|husky/i;
const HOOK_REASON = /fail|error|not found|denied|ELIFECYCLE|exit(ed)? (code )?[1-9]/i;
const HOOK_NOISE = /^(husky\b|error: failed to push some refs)/i;
const REASON_MAX = 200;

function hookReason(output: string): string | null {
  const lines = output
    .split('\n')
    .map((line) => line.replace(/^[^\w[(]+/, '').trim())
    .filter((line) => line !== '' && !HOOK_NOISE.test(line));
  const reason = lines.find((line) => HOOK_REASON.test(line)) ?? lines.at(-1);
  return reason ? reason.slice(0, REASON_MAX) : null;
}

function stoppedByHook(error: unknown): error is ShipGitError {
  return (
    error instanceof ShipGitError && PUSH_HOOK.test(error.output) && !PROTECTED.test(error.message)
  );
}

const HOOK_RUNNERS = ['husky', 'lefthook'] as const;
const REMOTE_HOOK = /pre-receive hook declined/i;

export interface PushFailureDetail {
  hook: string;
  output: string;
}

export function pushFailureDetail(error: unknown): PushFailureDetail | null {
  if (!(error instanceof ShipGitError)) return null;
  if (REMOTE_HOOK.test(error.output) || REMOTE_HOOK.test(error.message)) {
    return { hook: 'pre-receive (on the remote)', output: error.output };
  }
  if (!stoppedByHook(error)) return null;
  const runner = HOOK_RUNNERS.find((name) => new RegExp(`\\b${name}\\b`, 'i').test(error.output));
  return { hook: runner ? `pre-push (${runner})` : 'pre-push', output: error.output };
}

export function shipFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (stoppedByHook(error)) {
    const reason = hookReason(error.output);
    return `The push was stopped by this repository's pre-push check${reason ? `: ${reason}` : '.'} Spark never skips hooks; fix what the check reports, then try again.`;
  }
  if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403)) {
    return `${message} Reconnect GitHub in Settings → Integrations, then try again.`;
  }
  if (error instanceof ShipGitError && PROTECTED.test(message)) {
    return `${message} The remote's branch protection refused the push; check the repository's rules for Spark's branches.`;
  }
  if (error instanceof ShipGitError && GIT_AUTH.test(message) && !message.includes('terminal')) {
    return `${message} Git could not sign in to the remote; check that git push works for this repository in a terminal.`;
  }
  return message;
}
