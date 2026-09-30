import { z } from 'zod';
import type { Project } from '@spark-outpost/contracts';
import { conversationProjectIds } from '../../agent-config/store.ts';
import { groupBy } from '../../analytics/tally.ts';
import { mapStatus, projectMap } from '../../map/read-store.ts';
import type { Queryable } from '../../persistence/db.ts';
import { defaultBranch } from '../../projects/chat-worktrees.ts';
import { listProjects } from '../../projects/projects.ts';
import type { SparkScope } from '../deps.ts';
import { page } from '../format.ts';
import { limitInput, sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

interface ProjectFactsRow {
  id: string;
  work_place: string;
  chats: number;
  live_worktrees: number;
}

async function projectFacts(db: Queryable, workspaceId: string) {
  const { rows } = await db.query<ProjectFactsRow>(
    `SELECT p.id, p.work_place,
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
        chatsWorkIn: fact?.work_place === 'checkout' ? 'the checkout' : 'a chat worktree',
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
      'Projects linked in Spark: name, path, default branch, whether chats work in a chat worktree or the checkout, chat count, check commands and Map status.',
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
