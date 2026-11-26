import type { SparkAction } from '@spark-outpost/contracts';
import { saveAreaNote } from '../../map/area-notes.ts';
import { readIgnore } from '../../projects/project-fs.ts';
import { listProjects } from '../../projects/projects.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

type SaveMapNote = Extract<SparkAction, { action: 'save_map_note' }>;

export async function performSaveMapNote(
  context: SparkToolContext,
  action: SaveMapNote,
): Promise<Performed> {
  const projects = await listProjects(context.deps.db, context.scope.workspaceId);
  const project = projects.find((each) => each.id === action.projectId);
  if (!project) throw new Error(`${action.project} is no longer a project in Spark.`);
  await saveAreaNote(context.deps.db, {
    root: project.rootPath,
    areaId: action.areaId,
    text: action.text,
    sources: action.sources,
    ignore: await readIgnore(project.rootPath),
    conversationId: context.scope.conversationId,
  });
  return {
    message: `Saved the explanation of ${action.area} on ${action.project}'s Map.`,
    url: null,
    output: { saved: true, project: action.project, area: action.area },
  };
}
