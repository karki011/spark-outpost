import { ShipGitError } from './git.ts';
import { GitHubApiError } from './github/connection.ts';

const PROTECTED = /protected branch|GH006|pre-receive hook declined|push declined/i;
const GIT_AUTH =
  /authentication failed|could not read username|permission denied|could not read from remote|403/i;

export function shipFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof GitHubApiError && (error.status === 401 || error.status === 403)) {
    return `${message} Reconnect GitHub in Settings → Integrations, then try again.`;
  }
  if (error instanceof ShipGitError && PROTECTED.test(message)) {
    return `${message} The remote's branch protection refused the push; check the repository's rules for Spark's branches.`;
  }
  if (error instanceof ShipGitError && GIT_AUTH.test(message)) {
    return `${message} Git could not sign in to the remote; check that git push works for this repository in a terminal.`;
  }
  return message;
}
