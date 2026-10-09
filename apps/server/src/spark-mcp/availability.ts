import { conversationProjectIds } from '../agent-config/store.ts';
import { gitHubStatus } from '../ship/github/access.ts';
import { openSlack } from '../slack/connection.ts';
import { connectedSources } from '../tickets/connections.ts';
import {
  gitHubDepsFor,
  slackDepsFor,
  ticketDepsFor,
  type SparkScope,
  type SparkToolDeps,
} from './deps.ts';
import type { SparkToolNeed } from './tool.ts';

export type SparkAvailability = Readonly<Record<SparkToolNeed, boolean>>;

export const EVERYTHING_AVAILABLE: SparkAvailability = {
  tickets: true,
  slack: true,
  pull_requests: true,
  project: true,
  publish: true,
  pull_request_create: true,
  browser: true,
  outpost: true,
  outpost_draft: true,
};

async function chatHasProject(deps: SparkToolDeps, scope: SparkScope): Promise<boolean> {
  if (!scope.conversationId) return false;
  return (await conversationProjectIds(deps.db, scope.conversationId)).length > 0;
}

async function gitHubReach(deps: SparkToolDeps, scope: SparkScope) {
  const status = await gitHubStatus(gitHubDepsFor(deps, scope));
  const saved = status.token !== null || status.app.state === 'connected';
  const gh = status.ghCli.login !== null;
  return { connected: saved || gh, ownLogin: saved && !gh };
}

export async function sparkAvailability(
  deps: SparkToolDeps,
  scope: SparkScope,
): Promise<SparkAvailability> {
  const [sources, slack, project] = await Promise.all([
    connectedSources(ticketDepsFor(deps, scope)),
    openSlack(slackDepsFor(deps, scope)),
    chatHasProject(deps, scope),
  ]);
  const gitHub = project ? await gitHubReach(deps, scope) : { connected: false, ownLogin: false };
  return {
    tickets: sources.length > 0,
    slack: slack !== null,
    pull_requests: gitHub.connected,
    project,
    publish: project,
    pull_request_create: gitHub.ownLogin,
    browser: deps.browser !== undefined,
    outpost: false,
    outpost_draft: false,
  };
}

const HOW_TO_GET: Record<
  Exclude<
    SparkToolNeed,
    'browser' | 'publish' | 'pull_request_create' | 'outpost' | 'outpost_draft'
  >,
  string
> = {
  tickets: 'ticket tools (connect Jira or Linear in Settings → Connectors)',
  slack: 'Slack tools (connect Slack in Settings → Connectors)',
  pull_requests:
    'pull request tools (connect GitHub in Settings → Connectors and link a project to the chat)',
  project: 'spark_map and spark_find (link a project to the chat)',
};

export function unavailableNote(available: SparkAvailability): string {
  const missing = Object.entries(HOW_TO_GET)
    .filter(([need]) => !available[need as SparkToolNeed])
    .map(([, how]) => how);
  if (missing.length === 0) return '';
  return ` Not offered in this session: ${missing.join('; ')}. If the user asks for one, tell them that step; the tools arrive with their next message after it.`;
}
