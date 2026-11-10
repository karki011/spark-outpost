import { conversationProjectIds } from '../agent-config/store.ts';
import { calendarOffer, meetingsOffer } from './tools/calendar/offered.ts';
import { macRunRefusal, type MacRefusedRun } from '../mac-control/offered.ts';
import { rulesRunRefusal, type RulesRefusedRun } from './actions/rules-edit-session.ts';
import { listProjects } from '../projects/projects.ts';
import { outpostNeeds } from '../outposts/outpost-availability.ts';
import { gitHubReachability } from '../ship/github/access.ts';
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
  github: true,
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
  rules_edit: true,
  plugins_edit: true,
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

const RULES_HOW_TO: Partial<Record<RulesRefusedRun, string>> = {
  voice: 'spark_rules_edit (never for a spoken message; type it on the Mac)',
  remote: 'spark_rules_edit (not in a turn started from a paired device; ask from the Mac)',
};

const PLUGINS_HOW_TO: Partial<Record<RulesRefusedRun, string>> = {
  voice: 'spark_plugins_edit (never for a spoken message; type it on the Mac)',
  remote: 'spark_plugins_edit (not in a turn started from a paired device; ask from the Mac)',
};

const NO_PROJECT_PULL_REQUESTS = 'pull request tools (link a project to the chat)';

const ASK_SPARK_HOW_TO: Partial<Record<SparkToolNeed, string>> = {
  project: 'spark_map and spark_find (add a project in Spark first)',
  pull_requests:
    'pull request tools (connect GitHub in Settings → Connectors and add a project with a GitHub remote)',
};

async function gitHubReach(deps: SparkToolDeps, scope: SparkScope) {
  const { saved, ghLogin } = await gitHubReachability(gitHubDepsFor(deps, scope));
  const gh = ghLogin !== null;
  return { connected: saved || gh, ownLogin: saved && !gh };
}

export async function sparkAvailability(
  deps: SparkToolDeps,
  scope: SparkScope,
): Promise<SparkAvailability> {
  const tickets = ticketDepsFor(deps, scope);
  const [
    sources,
    slack,
    project,
    outposts,
    macRefused,
    calendar,
    jira,
    confluence,
    meetings,
    rulesRefused,
  ] = await Promise.all([
    connectedSources(tickets),
    openSlack(slackDepsFor(deps, scope)),
    scope.assistant ? anyProject(deps, scope) : chatHasProject(deps, scope),
    outpostNeeds(deps.db, scope),
    deps.mac ? macRunRefusal(deps.db, scope) : Promise.resolve(undefined),
    calendarOffer(deps, scope),
    productLive(tickets, 'jira'),
    productLive(tickets, 'confluence'),
    meetingsOffer(deps, scope),
    rulesRunRefusal(deps.db, scope),
  ]);
  const gitHub = await gitHubReach(deps, scope);
  const chat = scope.assistant !== true;
  const macHowTo = macRefused ? MAC_HOW_TO[macRefused] : undefined;
  const rulesHowTo = rulesRefused ? RULES_HOW_TO[rulesRefused] : undefined;
  const pluginsHowTo = rulesRefused ? PLUGINS_HOW_TO[rulesRefused] : undefined;
  return {
    tickets: sources.length > 0,
    ticket_create: sources.some((open) => open.connection.source !== 'servicenow'),
    servicenow: sources.some((open) => open.connection.source === 'servicenow'),
    slack: slack !== null,
    pull_requests: project && gitHub.connected,
    github: gitHub.connected && chat,
    project,
    publish: project && chat,
    pull_request_create: project && gitHub.ownLogin && chat,
    browser: deps.browser !== undefined,
    mac: macRefused === null,
    calendar_read: calendar.read,
    calendar_edit: calendar.edit,
    meetings,
    jira,
    confluence,
    rules_edit: rulesRefused === null,
    plugins_edit: rulesRefused === null,
    ...outposts,
    howTo: {
      ...(calendar.howTo.read ? { calendar_read: calendar.howTo.read } : {}),
      ...(calendar.howTo.edit ? { calendar_edit: calendar.howTo.edit } : {}),
      ...(macHowTo ? { mac: macHowTo } : {}),
      ...(rulesHowTo ? { rules_edit: rulesHowTo } : {}),
      ...(pluginsHowTo ? { plugins_edit: pluginsHowTo } : {}),
      ...(gitHub.connected ? { pull_requests: NO_PROJECT_PULL_REQUESTS } : {}),
      ...(chat ? {} : ASK_SPARK_HOW_TO),
    },
  };
}

const HOW_TO_GET: Record<
  Exclude<
    SparkToolNeed,
    | 'browser'
    | 'github'
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
    | 'rules_edit'
    | 'plugins_edit'
  >,
  string
> = {
  tickets: 'ticket tools (connect Atlassian, Linear or ServiceNow in Settings → Connectors)',
  confluence:
    'spark_confluence and spark_confluence_edit (connect Atlassian in Settings → Connectors and turn on its Confluence switch)',
  slack: 'Slack tools (connect Slack in Settings → Connectors)',
  pull_requests:
    'pull request and GitHub repo tools (connect GitHub in Settings → Connectors; PRs also need a linked project)',
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
