import { createMeta, editMeta, fieldText, shownMeta } from '../../../atlassian/jira-meta.ts';
import { attachmentsOf } from '../../../atlassian/jira-projects.ts';
import { searchUsers } from '../../../atlassian/jira-users.ts';
import type { AtlassianSession } from '../../../atlassian/session.ts';
import { SparkToolError } from '../../tool.ts';

export interface JiraReadArgs {
  action: string;
  key?: string | undefined;
  project?: string | undefined;
  issueType?: string | undefined;
  query?: string | undefined;
  id?: string | undefined;
  limit: number;
}

const DETAIL_FIELDS = [
  'assignee',
  'reporter',
  'components',
  'fixVersions',
  'versions',
  'duedate',
  'timetracking',
  'issuelinks',
  'attachment',
  'watches',
  'votes',
];
const TEXT_MAX = 12_000;
const IMAGE_MAX = 4 * 1024 * 1024;

const need = (value: string | undefined, what: string) => {
  if (!value) throw new SparkToolError(`Pass ${what}.`);
  return value;
};

interface RawLink {
  id?: string;
  type?: { inward?: string; outward?: string };
  inwardIssue?: { key?: string };
  outwardIssue?: { key?: string };
}

export function linksOf(key: string, value: unknown) {
  if (!Array.isArray(value)) return [];
  return (value as RawLink[]).flatMap((link) => {
    if (!link.id || !link.type) return [];
    if (link.outwardIssue?.key) {
      return [{ id: link.id, text: `${key} ${link.type.outward} ${link.outwardIssue.key}` }];
    }
    if (link.inwardIssue?.key) {
      return [{ id: link.id, text: `${key} ${link.type.inward} ${link.inwardIssue.key}` }];
    }
    return [];
  });
}

export async function issueDetails(session: AtlassianSession, key: string) {
  const fields = await session.jira.issueFields(key, DETAIL_FIELDS);
  const count = (value: unknown, name: string) =>
    (value as Record<string, unknown> | null)?.[name] ?? 0;
  return {
    assignee: fieldText(fields.assignee) || null,
    reporter: fieldText(fields.reporter) || null,
    components: fieldText(fields.components),
    fixVersions: fieldText(fields.fixVersions),
    affectsVersions: fieldText(fields.versions),
    dueDate: fieldText(fields.duedate) || null,
    estimate: fields.timetracking ?? null,
    links: linksOf(key, fields.issuelinks),
    attachments: attachmentsOf(fields.attachment).map((file) => ({
      id: file.id,
      filename: file.filename,
      size: file.size ?? null,
      mimeType: file.mimeType ?? null,
    })),
    watchers: count(fields.watches, 'watchCount'),
    votes: count(fields.votes, 'votes'),
  };
}

async function fields(session: AtlassianSession, args: JiraReadArgs) {
  if (args.key) return { fields: (await editMeta(session.jira.client, args.key)).map(shownMeta) };
  const project = need(args.project, 'key for an issue, or project and issueType');
  const metas = await createMeta(session.jira.client, project, need(args.issueType, 'issueType'));
  return { fields: metas.map(shownMeta) };
}

async function projectInfo(session: AtlassianSession, key: string) {
  const [project, components, versions] = await Promise.all([
    session.jira.projects.project(key),
    session.jira.projects.components(key),
    session.jira.projects.versions(key),
  ]);
  return {
    project: { key: project.key, name: project.name, teamManaged: project.style === 'next-gen' },
    components: components.map((entry) => ({ id: entry.id, name: entry.name })),
    versions: versions.map((entry) => ({
      id: entry.id,
      name: entry.name,
      released: entry.released ?? false,
      releaseDate: entry.releaseDate ?? null,
    })),
  };
}

export interface AttachmentRead {
  facts: Record<string, unknown>;
  image: { data: string; mimeType: string } | null;
}

export async function readAttachment(
  session: AtlassianSession,
  id: string,
): Promise<AttachmentRead> {
  const meta = await session.jira.projects.attachment(id);
  const mime = meta.mimeType ?? 'application/octet-stream';
  const facts = { id, filename: meta.filename, size: meta.size ?? null, mimeType: mime };
  const textual = mime.startsWith('text/') || /json|xml|csv|yaml/.test(mime);
  if (!textual && !mime.startsWith('image/')) {
    return { facts: { ...facts, note: 'Spark shows text and images only.' }, image: null };
  }
  const limit = textual ? TEXT_MAX * 4 : IMAGE_MAX;
  const file = await session.jira.transfer.download(
    `/rest/api/3/attachment/content/${encodeURIComponent(id)}`,
    limit,
    `downloading ${meta.filename}`,
  );
  if (textual) {
    const text = file.data.toString('utf8');
    return {
      facts: {
        ...facts,
        text: text.slice(0, TEXT_MAX),
        ...(text.length > TEXT_MAX || file.truncated ? { truncated: true } : {}),
      },
      image: null,
    };
  }
  if (file.truncated) return { facts: { ...facts, note: 'The image is over 4 MB.' }, image: null };
  return { facts, image: { data: file.data.toString('base64'), mimeType: file.mimeType } };
}

export async function otherRead(session: AtlassianSession, args: JiraReadArgs): Promise<unknown> {
  const { jira } = session;
  switch (args.action) {
    case 'fields':
      return fields(session, args);
    case 'transitions': {
      const moves = await jira.work.transitions(need(args.key, 'key'));
      return {
        transitions: moves.map((move) => ({
          id: move.id,
          name: move.name,
          to: move.to,
          fields: move.fields.map(shownMeta),
        })),
      };
    }
    case 'users':
      return {
        users: await searchUsers(
          jira.client,
          need(args.query, 'query'),
          args.key ?? null,
          args.limit,
        ),
      };
    case 'projects':
      return { projects: await jira.projects.search(args.query ?? '', args.limit) };
    case 'project':
      return projectInfo(session, need(args.project, 'project'));
    case 'link_types':
      return { linkTypes: await jira.work.linkTypes() };
    case 'worklogs':
      return jira.work.worklogs(need(args.key, 'key'), args.limit);
    case 'watchers': {
      const key = need(args.key, 'key');
      const [watchers, votes] = await Promise.all([jira.work.watchers(key), jira.work.votes(key)]);
      return { ...watchers, ...votes };
    }
    case 'boards':
      return { boards: await jira.agile.boards(args.project ?? null) };
    case 'sprints': {
      const sprints = await jira.agile.sprints(
        Number(need(args.id, 'id: the board id')),
        args.query ?? 'active,future',
      );
      return {
        sprints: sprints.map((sprint) => ({
          id: sprint.id,
          name: sprint.name,
          state: sprint.state,
          startDate: sprint.startDate ?? null,
          endDate: sprint.endDate ?? null,
          goal: sprint.goal ?? null,
        })),
      };
    }
    default:
      throw new SparkToolError(`${args.action} is not a Jira read.`);
  }
}
