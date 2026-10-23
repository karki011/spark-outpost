import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  fakeJira,
  JIRA_ME,
  jiraPeople,
  type FakeJira,
  type FakeJiraIssue,
} from '../../apps/server/test/fake-jira.ts';
import type { DevStatusMode, FakeDevelopment } from '../../apps/server/test/fake-jira-dev.ts';
import { fakeConfluence } from '../../apps/server/test/fake-confluence.ts';
import { fakeServiceNow } from '../../apps/server/test/fake-servicenow.ts';
import {
  fakeLinear,
  LINEAR_ME,
  linearPeople,
  type FakeLinearIssue,
} from '../../apps/server/test/fake-linear.ts';

const DAY_MS = 24 * 3_600_000;

const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const jiraDaysAgo = (days: number) => isoDaysAgo(days).replace('Z', '+0000');

function dayFromNow(days: number): string {
  const date = new Date(Date.now() + days * DAY_MS);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function linearIssue(
  fields: Partial<FakeLinearIssue> & Pick<FakeLinearIssue, 'identifier' | 'title'>,
): FakeLinearIssue {
  const team = fields.identifier.split('-')[0]!;
  return {
    id: `id-${fields.identifier}`,
    description: '',
    team,
    stateId: `${team.toLowerCase()}-todo`,
    updatedAt: isoDaysAgo(1),
    assigneeId: LINEAR_ME,
    priority: 3,
    dueDate: null,
    completedAt: null,
    createdAt: isoDaysAgo(5),
    creatorId: 'user-3',
    labels: [],
    comments: [],
    attachments: [],
    children: [],
    ...fields,
  };
}

const states = (team: string) => [
  { id: `${team}-todo`, name: 'Todo', type: 'unstarted' as const },
  { id: `${team}-progress`, name: 'In Progress', type: 'started' as const },
  { id: `${team}-review`, name: 'In Review', type: 'started' as const },
  { id: `${team}-done`, name: 'Done', type: 'completed' as const },
];

function seedLinear() {
  const linear = fakeLinear();
  linearPeople['user-3'] = 'Sam Ortiz';
  linear.teams.WEB = states('web');
  linear.teams.ENG = states('eng');
  linear.issues.splice(
    0,
    linear.issues.length,
    linearIssue({
      identifier: 'WEB-433',
      title: 'Session expires during long uploads',
      priority: 1,
      labels: ['upload'],
      description:
        'Uploads over 20 minutes lose the session.\n\n## Acceptance criteria\n\n- The session refreshes while an upload runs\n- A failed refresh says so',
      comments: [{ body: 'Seen on Safari too.', createdAt: isoDaysAgo(2), user: 'Sam Ortiz' }],
    }),
    linearIssue({
      identifier: 'ENG-1215',
      title: 'Write the release notes for 3.2',
      dueDate: dayFromNow(0),
      priority: 3,
      creatorId: null,
    }),
    linearIssue({
      identifier: 'WEB-421',
      title: 'Filter chips overflow the toolbar on small screens',
      stateId: 'web-progress',
      priority: 2,
      updatedAt: isoDaysAgo(0),
    }),
    linearIssue({
      identifier: 'WEB-418',
      title: 'Date divider shows Today twice after a refresh',
      stateId: 'web-review',
      priority: 2,
    }),
    linearIssue({
      identifier: 'ENG-1210',
      title: 'Tidy the settings copy',
      priority: 4,
      dueDate: dayFromNow(8),
    }),
    linearIssue({
      identifier: 'WEB-440',
      title: 'Upload progress bar jumps back to 0%',
      priority: 2,
      assigneeId: null,
      labels: ['upload', 'bug'],
      description: 'On a flaky connection the progress bar resets to 0% when a chunk is retried.',
    }),
    linearIssue({
      identifier: 'WEB-437',
      title: 'Uploads over 2 GB fail without an error',
      stateId: 'web-progress',
      assigneeId: 'user-2',
      priority: 2,
    }),
    linearIssue({
      identifier: 'ENG-1221',
      title: 'Shrink the 40 MB upload test fixture',
      assigneeId: 'user-3',
      priority: 4,
    }),
    linearIssue({
      identifier: 'ENG-1190',
      title: 'Remove the old onboarding flag',
      stateId: 'eng-done',
      completedAt: isoDaysAgo(2),
    }),
  );
  return linear;
}

function jiraIssue(fields: Partial<FakeJiraIssue> & Pick<FakeJiraIssue, 'key' | 'summary'>) {
  return {
    description: null,
    status: 'To Do',
    updated: jiraDaysAgo(1),
    assignee: JIRA_ME,
    priority: 'Medium',
    duedate: null,
    resolutiondate: null,
    reporter: 'acc-3',
    created: jiraDaysAgo(6),
    labels: [],
    comments: [],
    remoteLinks: [],
    subtasks: [],
    ...fields,
  } satisfies FakeJiraIssue;
}

function seedJira() {
  const jira = fakeJira();
  jiraPeople['acc-3'] = 'Priya Nair';
  jira.workflows.API = {
    'To Do': 'new',
    'Ready for implementation': 'new',
    'In Progress': 'indeterminate',
    'Code Review': 'indeterminate',
    Blocked: 'indeterminate',
    Done: 'done',
  };
  jira.issues.splice(
    0,
    jira.issues.length,
    jiraIssue({
      key: 'API-81',
      summary: 'Paginate the audit export endpoint',
      priority: 'High',
      status: 'Blocked',
      labels: ['api'],
    }),
    jiraIssue({
      key: 'API-77',
      summary: 'Rate limit headers missing on 429 responses',
      status: 'Code Review',
      priority: 'High',
    }),
    jiraIssue({ key: 'API-84', summary: 'Document the webhook retries', priority: 'Low' }),
    jiraIssue({
      key: 'API-95',
      summary: 'Resumable uploads for files over 1 GB',
      assignee: null,
      priority: 'Low',
      status: 'Ready for implementation',
      remoteLinks: [
        {
          globalId: 'https://github.com/acme/api/pull/52',
          url: 'https://github.com/acme/api/pull/52',
          title: 'Resumable upload spike',
        },
      ],
    }),
    jiraIssue({
      key: 'API-90',
      summary: 'Rotate the signing keys',
      status: 'Done',
      resolutiondate: jiraDaysAgo(3),
    }),
  );
  return jira;
}

const VOLUME_TITLES = [
  'Work items tab rolls AI cost up the ticket hierarchy',
  'We need to be able to determine across an organization whether or not Collector is installed everywhere and working as expected',
  'Design system: light-mode warning token is too low-contrast for text',
  'Telemetry page should keep search and sort when returning from a stream detail page',
  'Dimension Workload page: count hierarchy on the classification card, and the mean label while the meter is under review',
  'Host in github page',
  'Explorer Results: rename the Change summary toggle to Aggregate',
  'Five permissions on the role screen have no description, and a customer read MCP Settings as controlling MCP access',
];

const VOLUME_GROUPS: { count: number; fields: (index: number) => Partial<FakeJiraIssue> }[] = [
  { count: 3, fields: () => ({ status: 'In Progress' }) },
  {
    count: 20,
    fields: (index) => ({ status: 'Backlog', priority: index % 7 === 6 ? 'Low' : 'Medium' }),
  },
  { count: 2, fields: () => ({ status: 'Ready for Code Review' }) },
  {
    count: 46,
    fields: (index) => ({
      status: index % 9 === 1 ? 'Rejected' : 'Done',
      resolutiondate: jiraDaysAgo(1 + (index % 6)),
    }),
  },
];

function seedVolume() {
  const jira = fakeJira();
  jira.workflows.CP = {
    Backlog: 'new',
    'In Progress': 'indeterminate',
    'Ready for Code Review': 'indeterminate',
    Done: 'done',
    Rejected: 'done',
  };
  const issues = VOLUME_GROUPS.flatMap((group) =>
    Array.from({ length: group.count }, (_, index) => group.fields(index)),
  ).map((fields, index) =>
    jiraIssue({
      key: `CP-${48_001 + index}`,
      summary: VOLUME_TITLES[index % VOLUME_TITLES.length]!,
      ...fields,
    }),
  );
  jira.issues.splice(0, jira.issues.length, ...issues);
  return jira;
}

export function ticketFakes() {
  let linear = seedLinear();
  let jira = seedJira();
  let confluence = fakeConfluence();
  const servicenow = fakeServiceNow();
  return {
    reset() {
      linear = seedLinear();
      jira = seedJira();
      confluence = fakeConfluence();
      servicenow.reset();
    },
    serviceNowWrites() {
      return servicenow.writes;
    },
    serviceNowFaults(faults: { denied?: string[]; limited?: number }) {
      servicenow.denied = new Set(faults.denied ?? []);
      servicenow.limited = faults.limited ?? 0;
    },
    confluenceReachable(reachable: boolean) {
      confluence.reachable = reachable;
    },
    volume() {
      jira = seedVolume();
    },
    slowCreates(delayMs: number, failures: number) {
      linear.creating.delayMs = delayMs;
      linear.creating.failures = failures;
    },
    denyAssign(project: string) {
      jira.denyAssign.add(project);
    },
    jiraWorkflow(project: string, statuses: FakeJira['workflows'][string]) {
      jira.workflows[project] = statuses;
      for (const issue of jira.issues) {
        if (issue.key.startsWith(`${project}-`) && !(issue.status in statuses)) {
          issue.status = Object.keys(statuses)[0]!;
        }
      }
    },
    development(key: string, development: FakeDevelopment) {
      jira.development[key] = development;
    },
    devStatusMode(mode: DevStatusMode) {
      jira.devStatus.mode = mode;
    },
    handles(path: string): boolean {
      return (
        servicenow.handles(path) ||
        path.startsWith('/linear/') ||
        path.startsWith('/wiki/') ||
        path.startsWith('/rest/api/3/') ||
        path.startsWith('/rest/dev-status/')
      );
    },
    handle(req: IncomingMessage, res: ServerResponse, path: string) {
      if (path.startsWith('/linear/')) return linear.handle(req, res);
      if (path.startsWith('/wiki/')) return confluence.handle(req, res);
      if (servicenow.handles(path)) return servicenow.handle(req, res);
      return jira.handle(req, res);
    },
  };
}
