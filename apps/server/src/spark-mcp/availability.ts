import { conversationProjectIds } from '../agent-config/store.ts';
import { calendarOffer, meetingsOffer } from './tools/calendar/offered.ts';
import { macRunRefusal, type MacRefusedRun } from '../mac-control/offered.ts';
import { listProjects } from '../projects/projects.ts';
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

export interface SparkAvailability extends Readonly<Record<SparkToolNeed, boolean>> {
  readonly howTo?: Readonly<Partial<Record<SparkToolNeed, string>>>;
}

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
  outpost_start: true,
  calendar_read: true,
  calendar_edit: true,
  meetings: true,
  jira: true,
  confluence: true,
  servicenow: true,
  ticket_create: true,
};

async function chatHasProject(deps: SparkToolDeps, scope: SparkScope): Promise<boolean> {
  if (!scope.conversationId) return false;
  return (await conversationProjectIds(deps.db, scope.conversationId)).length > 0;
}

async function anyProject(deps: SparkToolDeps, scope: SparkScope): Promise<boolean> {
  return (await listProjects(deps.db, scope.workspaceId)).length > 0;
}

const MAC_HOW_TO: Partial<Record<MacRefusedRun, string>> = {
  off: 'spark_mac_* (turn on Let agents control other Mac apps in Settings → Mac control and allow Accessibility)',
  voice: 'spark_mac_* (never for a spoken question; type it instead)',
  remote: 'spark_mac_* (not in a turn started from a paired device; ask from the Mac)',
};

const ASK_SPARK_HOW_TO: Partial<Record<SparkToolNeed, string>> = {
  project: 'spark_map and spark_find (add a project in Spark first)',
  pull_requests:
    'pull request tools (connect GitHub in Settings → Connectors and add a project with a GitHub remote)',
};

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
  const [sources, slack, project, outposts, macRefused, calendar, jira, confluence, meetings] =
    await Promise.all([
      connectedSources(tickets),
      openSlack(slackDepsFor(deps, scope)),
      scope.assistant ? anyProject(deps, scope) : chatHasProject(deps, scope),
      outpostNeeds(deps.db, scope),
      deps.mac ? macRunRefusal(deps.db, scope) : Promise.resolve(undefined),
      calendarOffer(deps, scope),
      productLive(tickets, 'jira'),
      productLive(tickets, 'confluence'),
      meetingsOffer(deps, scope),
    ]);
  const gitHub = project ? await gitHubReach(deps, scope) : { connected: false, ownLogin: false };
  const chat = scope.assistant !== true;
  const macHowTo = macRefused ? MAC_HOW_TO[macRefused] : undefined;
  return {
    tickets: sources.length > 0,
    ticket_create: sources.some((open) => open.connection.source !== 'servicenow'),
    servicenow: sources.some((open) => open.connection.source === 'servicenow'),
    slack: slack !== null,
    pull_requests: gitHub.connected,
    project,
    publish: project && chat,
    pull_request_create: gitHub.ownLogin && chat,
    browser: deps.browser !== undefined,
    mac: macRefused === null,
    calendar_read: calendar.read,
    calendar_edit: calendar.edit,
    meetings,
    jira,
    confluence,
    ...outposts,
    howTo: {
      ...(calendar.howTo.read ? { calendar_read: calendar.howTo.read } : {}),
      ...(calendar.howTo.edit ? { calendar_edit: calendar.howTo.edit } : {}),
      ...(macHowTo ? { mac: macHowTo } : {}),
      ...(chat ? {} : ASK_SPARK_HOW_TO),
    },
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
    | 'outpost_start'
    | 'calendar_read'
    | 'calendar_edit'
    | 'meetings'
    | 'jira'
    | 'servicenow'
    | 'ticket_create'
  >,
  string
> = {
  tickets: 'ticket tools (connect Atlassian, Linear or ServiceNow in Settings → Connectors)',
  confluence:
    'spark_confluence and spark_confluence_edit (connect Atlassian in Settings → Connectors and turn on its Confluence switch)',
  slack: 'Slack tools (connect Slack in Settings → Connectors)',
  pull_requests:
    'pull request tools (connect GitHub in Settings → Connectors and link a project to the chat)',
  project: 'spark_map and spark_find (link a project to the chat)',
};

export function unavailableNote(available: SparkAvailability): string {
  const howTo: Partial<Record<SparkToolNeed, string>> = { ...HOW_TO_GET, ...available.howTo };
  const missing = Object.entries(howTo)
    .filter(([need]) => !available[need as SparkToolNeed])
    .map(([, how]) => how);
  if (missing.length === 0) return '';
  return ` Not offered in this session: ${missing.join('; ')}. If the user asks for one, tell them exactly that setting and where it is, never a guess; the tools arrive with their next message after it.`;
}
