import { conversationProjectIds } from '../agent-config/store.ts';
import { calendarOffer } from './tools/calendar/offered.ts';
import { macRunRefusal } from '../mac-control/offered.ts';
import { outpostNeeds } from '../outposts/outpost-availability.ts';
import { gitHubStatus } from '../ship/github/access.ts';
import { openSlack } from '../slack/connection.ts';
import { productLive } from '../atlassian/session.ts';
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
  mac: true,
  outpost: true,
  outpost_draft: true,
  calendar_read: true,
  calendar_edit: true,
  jira: true,
  confluence: true,
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
  const tickets = ticketDepsFor(deps, scope);
  const [sources, slack, project, outposts, macRefused, calendar, jira, confluence] =
    await Promise.all([
      connectedSources(tickets),
      openSlack(slackDepsFor(deps, scope)),
      chatHasProject(deps, scope),
      outpostNeeds(deps.db, scope),
      deps.mac ? macRunRefusal(deps.db, scope) : Promise.resolve('off' as const),
      calendarOffer(deps, scope),
      productLive(tickets, 'jira'),
      productLive(tickets, 'confluence'),
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
    mac: macRefused === null,
    calendar_read: calendar.read,
    calendar_edit: calendar.edit,
    jira,
    confluence,
    ...outposts,
  };
}

const HOW_TO_GET: Record<
  Exclude<
    SparkToolNeed,
    | 'browser'
    | 'mac'
    | 'publish'
    | 'pull_request_create'
    | 'outpost'
    | 'outpost_draft'
    | 'calendar_read'
    | 'calendar_edit'
    | 'jira'
  >,
  string
> = {
  tickets: 'ticket tools (connect Atlassian or Linear in Settings → Connectors)',
  confluence: 'Confluence tools (turn Confluence on in Atlassian)',
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
