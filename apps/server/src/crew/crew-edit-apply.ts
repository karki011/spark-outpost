import { CREW_EDIT_CONFLICT, workflowSchema, type CrewFileChange } from '@spark-outpost/contracts';
import {
  WorkflowChangedError,
  WorkflowExistsError,
  type WorkflowStore,
} from '../crew-flows/workflow-store.ts';
import {
  CrewFileConflictError,
  CrewFileNotFoundError,
  deleteCrewFile,
  readCrewFile,
  saveCrewFile,
} from './spark-folder.ts';

export class CrewEditConflictError extends Error {}

const ASK_AGAIN = 'Read it again with spark_crew and propose the change again.';

function conflict(paths: readonly string[], written: readonly string[]): CrewEditConflictError {
  const done =
    written.length === 0
      ? 'Spark changed nothing.'
      : `Spark had already written ${written.join(', ')} and stopped there.`;
  return new CrewEditConflictError(
    `${CREW_EDIT_CONFLICT}: ${paths.join(', ')}. ${done} ${ASK_AGAIN}`,
  );
}

async function currentHash(sparksDir: string, sparkId: string, path: string) {
  try {
    return (await readCrewFile(sparksDir, sparkId, path)).hash;
  } catch (error) {
    if (error instanceof CrewFileNotFoundError) return null;
    throw error;
  }
}

async function writeOne(sparksDir: string, sparkId: string, file: CrewFileChange): Promise<void> {
  if (file.change === 'deleted') {
    if ((await currentHash(sparksDir, sparkId, file.path)) !== file.baseHash) {
      throw new CrewFileConflictError();
    }
    await deleteCrewFile(sparksDir, sparkId, file.path);
    return;
  }
  await saveCrewFile(sparksDir, sparkId, {
    path: file.path,
    text: file.after ?? '',
    baseHash: file.baseHash,
  });
}

export async function applySparkEdit(
  sparksDir: string,
  sparkId: string,
  files: readonly CrewFileChange[],
): Promise<void> {
  const stale: string[] = [];
  for (const file of files) {
    if ((await currentHash(sparksDir, sparkId, file.path)) !== file.baseHash) stale.push(file.path);
  }
  if (stale.length > 0) throw conflict(stale, []);
  const ordered = [
    ...files.filter((file) => file.change === 'deleted'),
    ...files.filter((file) => file.change !== 'deleted'),
  ];
  const written: string[] = [];
  for (const file of ordered) {
    try {
      await writeOne(sparksDir, sparkId, file);
    } catch (error) {
      if (error instanceof CrewFileConflictError || error instanceof CrewFileNotFoundError) {
        throw conflict([file.path], written);
      }
      throw error;
    }
    written.push(file.path);
  }
}

export async function applyWorkflowEdit(
  store: WorkflowStore,
  id: string,
  file: CrewFileChange,
  sparkIds: ReadonlySet<string>,
): Promise<void> {
  if (file.change === 'deleted') {
    const current = await store.read(id);
    if (!current || current.hash !== file.baseHash) throw conflict([file.path], []);
    await store.remove(id);
    return;
  }
  const workflow = workflowSchema.parse(JSON.parse(file.after ?? ''));
  try {
    await store.save(workflow, file.baseHash, sparkIds);
  } catch (error) {
    if (error instanceof WorkflowChangedError || error instanceof WorkflowExistsError) {
      throw conflict([file.path], []);
    }
    throw error;
  }
}
