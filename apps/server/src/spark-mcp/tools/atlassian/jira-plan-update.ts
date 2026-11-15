import type {
  JiraCardRow,
  JiraChanges,
  JiraEditAction,
  JiraIssueFacts,
} from '@spark-outpost/contracts';
import type { JiraFacts } from '../../../atlassian/jira-edits.ts';
import { resolveTeam } from '../../../atlassian/jira-hierarchy.ts';
import {
  editMeta,
  fieldText,
  fieldValue,
  findField,
  userLookup,
  type JiraFieldMeta,
} from '../../../atlassian/jira-meta.ts';
import { resolveUser } from '../../../atlassian/jira-users.ts';
import type { AtlassianSession } from '../../../atlassian/session.ts';
import { projectOfKey } from '../../../tickets/ticket-relations.ts';
import { SparkToolError } from '../../tool.ts';
import type { JiraEditArgs } from './jira-edit-input.ts';
import { baseAction, cardText, row } from './jira-plans.ts';

type ShownFacts = Pick<JiraFacts, 'summary' | 'description' | 'labels' | 'priority' | 'type'> & {
  parent: string | null;
  team: string | null;
};

interface Write {
  label: string;
  field: string;
  after: string;
}

interface Planned {
  fields: Record<string, unknown>;
  update: Record<string, unknown>;
  writes: Write[];
  addLabels: string[];
  removeLabels: string[];
}

const teamLabel = (team: { id: string; name: string | null } | null) =>
  team ? (team.name ?? team.id) : null;
const dashed = (labels: readonly string[]) => labels.map((label) => label.replace(/\s+/g, '-'));

export function issueFacts(facts: ShownFacts): JiraIssueFacts {
  return {
    summary: facts.summary,
    description: cardText(facts.description),
    labels: facts.labels,
    priority: facts.priority,
    parent: facts.parent,
    type: facts.type,
    team: facts.team,
  };
}

export const shown = (facts: JiraFacts): ShownFacts => ({
  ...facts,
  parent: facts.parent?.key ?? null,
  team: teamLabel(facts.team),
});

async function changesOf(
  session: AtlassianSession,
  args: JiraEditArgs,
  key: string,
): Promise<JiraChanges> {
  const changes: JiraChanges = {};
  if (args.summary !== undefined) changes.summary = args.summary;
  if (args.description !== undefined) changes.description = args.description;
  if (args.labels !== undefined) changes.labels = dashed(args.labels);
  if (args.priority !== undefined) changes.priority = args.priority;
  if (args.parent !== undefined && args.parent.toLowerCase() !== 'none') {
    changes.parent = args.parent.toUpperCase();
  }
  if (args.issueType !== undefined) changes.issueType = args.issueType;
  if (args.team !== undefined) {
    const project = projectOfKey(key, null) ?? key;
    changes.team = await resolveTeam(session.jira.client, project, args.team);
  }
  return changes;
}

async function person(
  session: AtlassianSession,
  key: string,
  wanted: string,
  label: string,
  field: string,
  planned: Planned,
) {
  const user = await resolveUser(session.jira.client, wanted, {
    me: session.accountId,
    issueKey: key,
  });
  planned.fields[field] = user ? { accountId: user.accountId } : null;
  planned.writes.push({ label, field, after: user?.name ?? '' });
}

async function genericFields(
  session: AtlassianSession,
  key: string,
  wanted: Record<string, unknown>,
  planned: Planned,
) {
  const metas: JiraFieldMeta[] = await editMeta(session.jira.client, key);
  const users = userLookup(session.jira.client, { me: session.accountId, issueKey: key });
  for (const [name, value] of Object.entries(wanted)) {
    const meta = findField(metas, name);
    planned.fields[meta.id] = await fieldValue(meta, value, users);
    planned.writes.push({ label: meta.name, field: meta.id, after: fieldText(value) });
  }
}

async function extrasOf(
  session: AtlassianSession,
  args: JiraEditArgs,
  key: string,
): Promise<Planned> {
  const planned: Planned = { fields: {}, update: {}, writes: [], addLabels: [], removeLabels: [] };
  if (args.parent?.toLowerCase() === 'none') {
    planned.fields.parent = {};
  }
  if (args.assignee) await person(session, key, args.assignee, 'Assignee', 'assignee', planned);
  if (args.reporter) await person(session, key, args.reporter, 'Reporter', 'reporter', planned);
  if (args.originalEstimate || args.remainingEstimate) {
    planned.fields.timetracking = {
      ...(args.originalEstimate ? { originalEstimate: args.originalEstimate } : {}),
      ...(args.remainingEstimate ? { remainingEstimate: args.remainingEstimate } : {}),
    };
    const after = [args.originalEstimate, args.remainingEstimate].map((v) => v ?? '–').join(' / ');
    planned.writes.push({ label: 'Estimate (original / remaining)', field: 'timetracking', after });
  }
  planned.addLabels = dashed(args.addLabels ?? []);
  planned.removeLabels = dashed(args.removeLabels ?? []);
  const labelOps = [
    ...planned.addLabels.map((label) => ({ add: label })),
    ...planned.removeLabels.map((label) => ({ remove: label })),
  ];
  if (labelOps.length > 0) planned.update.labels = labelOps;
  if (args.fields && Object.keys(args.fields).length > 0) {
    await genericFields(session, key, args.fields, planned);
  }
  return planned;
}

function before(field: string, value: unknown): string {
  if (field !== 'timetracking') return fieldText(value);
  const tracking = (value ?? {}) as { originalEstimate?: string; remainingEstimate?: string };
  return [tracking.originalEstimate, tracking.remainingEstimate].map((v) => v ?? '–').join(' / ');
}

async function rowsFor(
  session: AtlassianSession,
  facts: JiraFacts,
  planned: Planned,
  keyed: boolean,
): Promise<JiraCardRow[]> {
  const key = keyed ? facts.key : null;
  const ids = [...new Set(planned.writes.map((write) => write.field))];
  const current = ids.length > 0 ? await session.jira.issueFields(facts.key, ids) : {};
  const rows = planned.writes.map((write) =>
    row(write.label, before(write.field, current[write.field]), write.after, key),
  );
  if (planned.addLabels.length > 0 || planned.removeLabels.length > 0) {
    const after = [...new Set([...facts.labels, ...planned.addLabels])].filter(
      (label) => !planned.removeLabels.includes(label),
    );
    rows.push(row('Labels', facts.labels.join(', '), after.join(', '), key));
  }
  return rows;
}

function legacyRows(facts: JiraFacts, changes: JiraChanges, removesParent: boolean): JiraCardRow[] {
  const now = shown(facts);
  const pairs: [string, string | null | undefined, string | null | undefined][] = [
    ['Summary', now.summary, changes.summary],
    ['Priority', now.priority, changes.priority],
    ['Labels', now.labels.join(', '), changes.labels?.join(', ')],
    ['Type', now.type, changes.issueType],
    ['Parent', now.parent, removesParent ? '' : changes.parent],
    ['Team', now.team, changes.team ? teamLabel(changes.team) : undefined],
    ['Description', now.description, changes.description],
  ];
  return pairs
    .filter(([, , after]) => after !== undefined)
    .map(([label, was, after]) => row(label, was ?? '', after ?? '', facts.key));
}

export async function planUpdate(
  session: AtlassianSession,
  args: JiraEditArgs,
): Promise<JiraEditAction> {
  const keys = [...new Set([args.key, ...(args.keys ?? [])].filter((key): key is string => !!key))];
  if (keys.length === 0) throw new SparkToolError('Pass key, or keys for several issues.');
  const first = keys[0]!;
  const projects = new Set(keys.map((key) => projectOfKey(key, null) ?? key));
  if (projects.size > 1 && (args.fields || args.team || args.assignee || args.reporter)) {
    throw new SparkToolError(
      'fields, team, assignee and reporter are checked per project; pass keys from one project at a time. Nothing was changed.',
    );
  }
  const changes = await changesOf(session, args, first);
  const planned = await extrasOf(session, args, first);
  const removesParent = args.parent?.toLowerCase() === 'none';
  const nothing = planned.writes.length === 0 && !planned.update.labels && !removesParent;
  if (Object.keys(changes).length === 0 && nothing) {
    throw new SparkToolError(
      'Pass something to change: summary, description, labels, priority, parent, issueType, team, assignee, reporter, estimates or fields.',
    );
  }
  const all = await Promise.all(keys.map((key) => session.jira.facts(key)));
  const facts = all[0]!;
  const keyed = all.length > 1;
  const rows = (
    await Promise.all(
      all.map(async (each) => [
        ...(keyed ? legacyRows(each, changes, removesParent) : []),
        ...(await rowsFor(session, each, planned, keyed)),
      ]),
    )
  ).flat();
  const now = shown(facts);
  return {
    ...baseAction(
      'update',
      { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
      facts.updated,
    ),
    changes,
    before: keyed ? null : issueFacts(now),
    after: keyed
      ? null
      : issueFacts({
          summary: changes.summary ?? now.summary,
          description: changes.description ?? now.description,
          labels: changes.labels ?? now.labels,
          priority: changes.priority ?? now.priority,
          parent: changes.parent ?? (removesParent ? null : now.parent),
          type: changes.issueType ?? now.type,
          team: changes.team ? teamLabel(changes.team) : now.team,
        }),
    rows,
    targets: all.slice(1).map((each) => ({
      key: each.key,
      title: each.summary,
      url: session.jira.browse(each.key),
      updated: each.updated,
    })),
    plan: { fields: planned.fields, update: planned.update },
  };
}
