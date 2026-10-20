import type { StartOutpostAction } from '@spark-outpost/contracts';
import { draftStartedMessage, startDraft } from '../../outposts/draft-start.ts';
import type { StartedBy } from '../../outposts/start-outpost.ts';
import type { SparkToolContext } from '../tool.ts';
import type { Performed } from './performed.ts';

export async function performStartOutpost(
  { deps, scope }: SparkToolContext,
  action: StartOutpostAction,
  startedBy: StartedBy,
): Promise<Performed> {
  const result = await startDraft(
    { db: deps.db, workspaceId: scope.workspaceId },
    action.draftId,
    startedBy,
  );
  return {
    message: draftStartedMessage(result),
    url: null,
    output: {
      outpostId: result.outpostId,
      outpost: result.outpostName,
      started: result.started,
      notStarted: result.failed.map(({ handle, message }) => ({ handle, message })),
    },
  };
}
