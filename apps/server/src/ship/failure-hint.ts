import { ShipGitError } from './git.ts';
import { GitHubApiError } from './github/connection.ts';
import { GIT_AUTH } from './push.ts';

const PROTECTED = /protected branch|GH006|pre-receive hook declined|push declined/i;

export function shipFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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
