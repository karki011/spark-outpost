import {
  CREW_CHANGE_LABELS,
  type CrewEditAction,
  type CrewFileChangeKind,
} from '@spark-outpost/contracts';
import { workflowStore } from '../../crew-flows/workflow-store.ts';
import { applySparkEdit, applyWorkflowEdit } from '../../crew/crew-edit-apply.ts';
import { crewSparksDir } from '../../crew/folders.ts';
import { closeTeammateSessions } from '../../persistence/teammate-chats.ts';
import { listTeammates } from '../../persistence/teammates.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export const SPARK_GONE = 'That Spark was deleted, so Spark changed nothing.';

const KINDS: readonly CrewFileChangeKind[] = ['new', 'changed', 'deleted'];

function counts(action: CrewEditAction): string {
  return KINDS.flatMap((kind) => {
    const count = action.files.filter((file) => file.change === kind).length;
    return count > 0 ? [`${count} ${CREW_CHANGE_LABELS[kind].toLowerCase()}`] : [];
  }).join(', ');
}

export async function performCrewEdit(
  context: SparkToolContext,
  action: CrewEditAction,
): Promise<Performed> {
  const { db } = context.deps;
  const { workspaceId } = context.scope;
  const teammates = await listTeammates(db, workspaceId);
  if (action.target === 'workflow') {
    const sparkIds = new Set(teammates.map((teammate) => teammate.id));
    await applyWorkflowEdit(workflowStore(), action.id, action.files[0]!, sparkIds);
    const verb = { new: 'Created', changed: 'Changed', deleted: 'Deleted' }[
      action.files[0]!.change
    ];
    return { message: `${verb} the ${action.name} workflow.`, url: null };
  }
  if (!teammates.some((teammate) => teammate.id === action.id)) throw new Error(SPARK_GONE);
  await applySparkEdit(crewSparksDir(), action.id, action.files);
  await closeTeammateSessions(db, workspaceId, action.id);
  const files = action.files.length === 1 ? 'file' : 'files';
  return { message: `Changed the ${action.name} Spark’s ${files}: ${counts(action)}.`, url: null };
}
