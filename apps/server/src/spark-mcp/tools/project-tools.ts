import { z } from 'zod';
import { PIECE_SLOTS_MAX, type Project, type WorkPlace } from '@spark-outpost/contracts';
import { conversationProjectIds } from '../../agent-config/store.ts';
import { groupBy } from '../../analytics/tally.ts';
import { mapStatus, projectMap } from '../../map/read-store.ts';
import type { Queryable } from '../../persistence/db.ts';
import { defaultBranch } from '../../projects/chat-worktrees.ts';
import { listProjects } from '../../projects/projects.ts';
import type { SparkScope } from '../deps.ts';
import { page } from '../format.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

const AT_ONCE =
  'Pieces of a big plan run at the same time, up to this many. Change it in Settings → Projects → Builders at once.';
const IN_ORDER =
  'Pieces of a big plan run one at a time, in order. Change it in Settings → Projects → Builders at once.';
const SERVER_IN_ORDER =
  "Spark's server is set to run pieces one at a time (COORDINATOR_MODE), so Builders work in order whatever the project setting says.";

interface ProjectFactsRow {
  id: string;
  chats: number;
  live_worktrees: number;
}

async function projectFacts(db: Queryable, workspaceId: string) {
  const { rows } = await db.query<ProjectFactsRow>(
    `SELECT p.id,
       (SELECT count(*)::int FROM conversation_projects cp WHERE cp.project_id = p.id) AS chats,
       (SELECT count(*)::int FROM chat_worktrees w
         WHERE w.project_id = p.id AND w.removed_at IS NULL) AS live_worktrees
     FROM projects p WHERE p.workspace_id = $1`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

function chatProjectIds(db: Queryable, scope: SparkScope): Promise<string[]> {
  return scope.conversationId
    ? conversationProjectIds(db, scope.conversationId)
    : Promise.resolve([]);
}

export async function findProject(
  { deps, scope }: SparkToolContext,
  reference: string | undefined,
): Promise<Project> {
  const projects = await listProjects(deps.db, scope.workspaceId);
  const wanted = reference?.trim().toLowerCase();
  if (wanted) {
    const found = projects.find(
      (project) => project.id === wanted || project.name.toLowerCase() === wanted,
    );
    if (found) return found;
    throw new SparkToolError(
      `No project called ${reference}. Projects: ${projects.map((project) => project.name).join(', ') || 'none'}.`,
    );
  }
  const [first] = await chatProjectIds(deps.db, scope);
  const linked = projects.find((project) => project.id === first);
  if (linked) return linked;
  throw new SparkToolError('This chat has no project. Pass a project name or id.');
}

function whereSparkWorks(place: WorkPlace | undefined) {
  return place === 'checkout'
    ? 'In my files (new chats edit the checkout directly)'
    : 'Each chat in its own worktree (a git worktree on its own branch; the checkout stays as it is)';
}

function buildersAtOnce(project: Project, parallel: boolean) {
  if (!parallel) return { value: 1, note: SERVER_IN_ORDER };
  const value = project.parallelPieces === false ? 1 : (project.pieceSlots ?? PIECE_SLOTS_MAX);
  return { value, note: value === 1 ? IN_ORDER : AT_ONCE };
}

async function projects({ deps, scope }: SparkToolContext, limit: number) {
  const [all, facts, linked] = await Promise.all([
    listProjects(deps.db, scope.workspaceId),
    projectFacts(deps.db, scope.workspaceId),
    chatProjectIds(deps.db, scope),
  ]);
  const shown = page(all, 0, limit);
  const items = await Promise.all(
    shown.items.map(async (project) => {
      const fact = facts.get(project.id);
      const [branch, map] = await Promise.all([
        defaultBranch(project.rootPath).catch(() => null),
        mapStatus(deps.db, project.rootPath),
      ]);
      return {
        id: project.id,
        name: project.name,
        path: project.displayPath,
        inThisChat: linked.includes(project.id),
        defaultBranch: branch,
        whereSparkWorks: whereSparkWorks(project.workPlace),
        buildersAtOnce: buildersAtOnce(project, deps.parallelBuilders !== false),
        liveChatWorktrees: fact?.live_worktrees ?? 0,
        chats: fact?.chats ?? 0,
        checkCommands: project.checkCommands ?? null,
        allowedCommands: project.commandAllowlist.length,
        lastUsedAt: project.lastUsedAt ?? null,
        map: map
          ? {
              status: map.status,
              areas: map.areaCount,
              files: map.fileCount,
              builtAt: map.builtAt,
              error: map.error,
            }
          : 'not built',
      };
    }),
  );
  return { ...shown, items };
}

async function map(context: SparkToolContext, reference: string | undefined, limit: number) {
  const project = await findProject(context, reference);
  const built = await projectMap(context.deps.db, project.id, project.rootPath);
  const areas = built.areas
    .toSorted((a, b) => b.importance - a.importance)
    .slice(0, limit)
    .map((area) => ({
      id: area.id,
      name: area.name,
      category: area.category,
      kind: area.kind,
      description: area.description,
      files: area.fileCount,
      lines: area.lineCount,
      usedBy: area.fanIn,
      uses: area.fanOut,
      topFiles: area.topFiles.slice(0, 5),
    }));
  const byCategory = Object.fromEntries(
    [...groupBy(built.areas, (area) => area.category)].map(([key, list]) => [key, list.length]),
  );
  return {
    project: project.name,
    status: built.status
      ? { state: built.status.status, phase: built.status.phase, builtAt: built.status.builtAt }
      : 'not built',
    totalAreas: built.areas.length,
    byCategory,
    areas,
  };
}

export const projectTools = [
  sparkTool({
    name: 'spark_projects',
    title: 'Projects',
    description:
      'Projects linked in Spark: name, path, default branch, Settings → Projects choices (Where Spark works: each chat in its own worktree or in my files; Builders at once: 1 at a time in order, or up to 2 or 3 in parallel), chat count, check commands and Map status.',
    input: { limit: limitInput(30, 100) },
    run: (args, context) => projects(context, args.limit),
  }),
  sparkTool({
    name: 'spark_map',
    title: 'Project map',
    description:
      "A project's Map: its main areas (name, category, what it does, size, top files) and counts per category. Defaults to this chat's project.",
    input: {
      project: z.string().max(200).optional().describe('Project name or id.'),
      limit: limitInput(25, 80),
    },
    run: (args, context) => map(context, args.project, args.limit),
  }),
];
