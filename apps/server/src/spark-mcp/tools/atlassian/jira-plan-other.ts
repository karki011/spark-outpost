import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { JiraEditAction } from '@spark-outpost/contracts';
import { chatKeptFolder } from '../../../chat-files/folders.ts';
import { fieldsOfType, SPRINT_TYPES } from '../../../atlassian/jira-hierarchy.ts';
import { fieldText } from '../../../atlassian/jira-meta.ts';
import type { AtlassianSession } from '../../../atlassian/session.ts';
import { isCredentialPath, isSecretPath, PathRefusedError } from '../../../projects/path-policy.ts';
import { projectPolicy, resolveInProject } from '../../../projects/project-fs.ts';
import { SparkToolError, type SparkToolContext } from '../../tool.ts';
import { needs, type JiraEditArgs } from './jira-edit-input.ts';
import { baseAction, row } from './jira-plans.ts';

export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.log': 'text/plain',
  '.zip': 'application/zip',
};

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function chatRoots(context: SparkToolContext): string[] {
  const roots = (context.scope.commands?.roots ?? []).map((root) => root.path);
  const { chatFolders } = context.deps;
  const chat = context.scope.conversationId;
  if (chatFolders && chat) roots.push(chatKeptFolder(chatFolders, chat));
  return roots;
}

async function attach(context: SparkToolContext, session: AtlassianSession, args: JiraEditArgs) {
  const facts = await session.jira.facts(needs(args.key, 'key'));
  const requested = needs(args.path, "path: a file in the chat's project or kept files");
  const roots = chatRoots(context);
  if (roots.length === 0)
    throw new SparkToolError('This chat has no project or kept files to upload from.');
  const policy = await projectPolicy(roots).catch(() => null);
  if (!policy) throw new SparkToolError("Spark couldn't open the chat's folders.");
  const real = path.isAbsolute(requested)
    ? await realpath(requested).catch(() => requested)
    : requested;
  const resolved = await resolveInProject(policy, real, 'read').catch((error: unknown) => {
    if (error instanceof PathRefusedError && error.reason === 'secret file') {
      throw new SparkToolError(`${requested} is a secret file. Spark never uploads it.`);
    }
    if (error instanceof PathRefusedError) {
      throw new SparkToolError(
        `Spark uploads only files inside the chat's projects or kept files (${error.reason}).`,
      );
    }
    throw error;
  });
  const root = policy.roots.find((entry) => entry.path === resolved.root);
  if (isSecretPath(resolved.relative, root?.ignore ?? []) || isCredentialPath(resolved.absolute)) {
    throw new SparkToolError(`${resolved.relative} is a secret file. Spark never uploads it.`);
  }
  const info = await stat(resolved.absolute);
  if (!info.isFile()) throw new SparkToolError(`${resolved.relative} is not a file.`);
  if (info.size > ATTACH_MAX_BYTES) throw new SparkToolError(`${resolved.relative} is over 10 MB.`);
  const data = await readFile(resolved.absolute);
  const name = path.basename(resolved.absolute);
  return {
    ...baseAction(
      'attach',
      { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
      facts.updated,
    ),
    rows: [row('File', null, `${resolved.relative} (${Math.ceil(info.size / 1024)} KB)`)],
    plan: {
      path: resolved.absolute,
      name,
      size: info.size,
      sha256: sha256(data),
      mimeType: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    },
  };
}

async function deleteAttachment(session: AtlassianSession, args: JiraEditArgs) {
  const facts = await session.jira.facts(needs(args.key, 'key'));
  const id = needs(args.id, 'id: the attachment id from spark_jira read');
  const file = await session.jira.projects.attachment(id);
  return {
    ...baseAction(
      'delete_attachment',
      { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
      facts.updated,
    ),
    rows: [row('Attachment', file.filename, null)],
    plan: { id },
  };
}

const CLONED = [
  'summary',
  'description',
  'issuetype',
  'priority',
  'labels',
  'components',
  'fixVersions',
  'versions',
  'parent',
  'project',
];

async function clone(session: AtlassianSession, args: JiraEditArgs) {
  const facts = await session.jira.facts(needs(args.key, 'key'));
  const team = await session.jira.teamFieldId();
  const source = await session.jira.issueFields(facts.key, team ? [...CLONED, team] : CLONED);
  const ref = (value: unknown) => (value as { id?: string } | null)?.id;
  const ids = (value: unknown) =>
    Array.isArray(value) ? value.flatMap((entry) => (ref(entry) ? [{ id: ref(entry) }] : [])) : [];
  const summary = args.name ?? `CLONE - ${facts.summary}`;
  const parentKey = (source.parent as { key?: string } | null)?.key;
  const teamId = team ? (source[team] as { id?: string } | null)?.id : undefined;
  const fields: Record<string, unknown> = {
    project: { key: (source.project as { key?: string } | null)?.key ?? facts.key.split('-')[0] },
    issuetype: ref(source.issuetype)
      ? { id: ref(source.issuetype) }
      : { name: facts.type ?? 'Task' },
    summary,
    ...(source.description ? { description: source.description } : {}),
    ...(ref(source.priority) ? { priority: { id: ref(source.priority) } } : {}),
    ...(Array.isArray(source.labels) && source.labels.length > 0 ? { labels: source.labels } : {}),
    ...(ids(source.components).length > 0 ? { components: ids(source.components) } : {}),
    ...(ids(source.fixVersions).length > 0 ? { fixVersions: ids(source.fixVersions) } : {}),
    ...(ids(source.versions).length > 0 ? { versions: ids(source.versions) } : {}),
    ...(parentKey ? { parent: { key: parentKey } } : {}),
    ...(team && teamId ? { [team]: teamId } : {}),
  };
  const copied = ['issuetype', 'priority', 'labels', 'components', 'fixVersions', 'parent']
    .map((field) => `${field}: ${fieldText(field === 'parent' ? parentKey : source[field]) || '–'}`)
    .join('; ');
  return {
    ...baseAction(
      'clone',
      { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
      facts.updated,
    ),
    rows: [row('New summary', null, summary), row('Copies', null, copied)],
    plan: { fields },
  };
}

async function sprintNames(session: AtlassianSession, keys: readonly string[]) {
  const [field] = await fieldsOfType(session.jira.client, SPRINT_TYPES).catch(() => []);
  return Promise.all(
    keys.map(async (key) => {
      const facts = await session.jira.facts(key);
      const value = field ? (await session.jira.issueFields(key, [field.id]))[field.id] : null;
      return { facts, sprint: fieldText(value) || 'Backlog' };
    }),
  );
}

async function moveIssues(session: AtlassianSession, args: JiraEditArgs) {
  const keys = [...new Set([args.key, ...(args.keys ?? [])].filter((key): key is string => !!key))];
  if (keys.length === 0) throw new SparkToolError('Pass key or keys.');
  const sprint =
    args.action === 'sprint'
      ? await session.jira.agile.sprint(Number(needs(args.id, 'id: the sprint id')))
      : null;
  if (sprint?.state === 'closed') throw new SparkToolError(`${sprint.name} is closed.`);
  const now = await sprintNames(session, keys);
  const first = now[0]!.facts;
  return {
    ...baseAction(
      args.action,
      { key: first.key, title: first.summary, url: session.jira.browse(first.key) },
      first.updated,
    ),
    rows: now.map(({ facts, sprint: was }) =>
      row('Sprint', was, sprint?.name ?? 'Backlog', facts.key),
    ),
    targets: now.slice(1).map(({ facts }) => ({
      key: facts.key,
      title: facts.summary,
      url: session.jira.browse(facts.key),
      updated: facts.updated,
    })),
    plan: sprint ? { sprintId: sprint.id, keys } : { keys },
  };
}

async function rank(session: AtlassianSession, args: JiraEditArgs) {
  const facts = await session.jira.facts(needs(args.key, 'key'));
  const other = needs(args.otherKey, 'otherKey');
  const after = args.to?.toLowerCase() === 'after';
  return {
    ...baseAction(
      'rank',
      { key: facts.key, title: facts.summary, url: session.jira.browse(facts.key) },
      facts.updated,
    ),
    rows: [row('Rank', null, `${after ? 'After' : 'Before'} ${other}`)],
    plan: { other, after },
  };
}

async function sprintChange(session: AtlassianSession, args: JiraEditArgs) {
  const id = Number(
    needs(args.id, args.action === 'create_sprint' ? 'id: the board id' : 'id: the sprint id'),
  );
  if (args.action === 'create_sprint') {
    const board = await session.jira.agile.board(id);
    const name = needs(args.name, 'name');
    return {
      ...baseAction(
        'create_sprint',
        { key: board.location?.projectKey ?? `board-${id}`, title: board.name, url: null },
        null,
      ),
      rows: [
        row('Sprint', null, name),
        row('Dates', null, `${args.start ?? '–'} to ${args.end ?? '–'}`),
        ...(args.body ? [row('Goal', null, args.body)] : []),
      ],
      plan: { boardId: id, name, startDate: args.start, endDate: args.end, goal: args.body },
    };
  }
  const sprint = await session.jira.agile.sprint(id);
  const starting = args.action === 'start_sprint';
  const expected = starting ? 'future' : 'active';
  if (sprint.state !== expected)
    throw new SparkToolError(`${sprint.name} is ${sprint.state}, not ${expected}.`);
  const ticket = { key: `sprint-${id}`, title: sprint.name, url: null };
  if (!starting) {
    return {
      ...baseAction('complete_sprint', ticket, sprint.state),
      rows: [row('State', 'active', 'closed')],
      plan: { sprintId: id },
    };
  }
  const startDate = args.start ?? sprint.startDate;
  const endDate = args.end ?? sprint.endDate;
  if (!startDate || !endDate)
    throw new SparkToolError('Pass start and end dates to start the sprint.');
  return {
    ...baseAction('start_sprint', ticket, sprint.state),
    rows: [row('State', 'future', 'active'), row('Dates', null, `${startDate} to ${endDate}`)],
    plan: { sprintId: id, startDate, endDate },
  };
}

async function version(session: AtlassianSession, args: JiraEditArgs) {
  if (args.action === 'create_version') {
    const project = await session.jira.projects.project(needs(args.project, 'project'));
    const name = needs(args.name, 'name');
    return {
      ...baseAction('create_version', { key: project.key, title: project.name, url: null }, null),
      rows: [
        row('Version', null, name),
        row('Dates', null, `${args.start ?? '–'} to ${args.end ?? '–'}`),
        ...(args.body ? [row('Description', null, args.body)] : []),
      ],
      plan: {
        projectId: project.id,
        name,
        description: args.body,
        startDate: args.start,
        releaseDate: args.end,
      },
    };
  }
  const found = await session.jira.projects.version(needs(args.id, 'id: the version id'));
  if (found.released) throw new SparkToolError(`${found.name} is already released.`);
  const releaseDate = args.end ?? new Date().toISOString().slice(0, 10);
  return {
    ...baseAction(
      'release_version',
      { key: `version-${found.id}`, title: found.name, url: null },
      null,
    ),
    rows: [row('Released', 'No', `Yes, ${releaseDate}`)],
    plan: { id: found.id, releaseDate },
  };
}

export function planOther(
  context: SparkToolContext,
  session: AtlassianSession,
  args: JiraEditArgs,
): Promise<JiraEditAction> {
  switch (args.action) {
    case 'attach':
      return attach(context, session, args);
    case 'delete_attachment':
      return deleteAttachment(session, args);
    case 'clone':
      return clone(session, args);
    case 'sprint':
    case 'backlog':
      return moveIssues(session, args);
    case 'rank':
      return rank(session, args);
    case 'create_sprint':
    case 'start_sprint':
    case 'complete_sprint':
      return sprintChange(session, args);
    case 'create_version':
    case 'release_version':
      return version(session, args);
    default:
      throw new SparkToolError(`${args.action} is not supported.`);
  }
}
