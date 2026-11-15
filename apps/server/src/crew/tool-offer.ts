import { childRun, spokenRun } from '../mac-control/offered.ts';
import type { Queryable } from '../persistence/db.ts';
import { runFromDevice } from '../remote/run-mark.ts';
import {
  remoteRunRefused,
  rulesRunRefusal,
  type RulesRefusedRun,
  type RulesRunScope,
} from '../spark-mcp/actions/rules-edit-session.ts';

export type CrewReadRefusedRun = 'remote' | 'child' | 'voice';

export async function crewReadRefusal(
  db: Queryable,
  scope: Pick<RulesRunScope, 'runId' | 'conversationId'>,
): Promise<CrewReadRefusedRun | null> {
  if (!scope.runId) return null;
  if (!scope.conversationId) {
    if (await runFromDevice(db, scope.runId)) return 'remote';
  } else if (await remoteRunRefused(db, scope.conversationId, scope.runId, 'crew')) {
    return 'remote';
  }
  if (await childRun(db, scope.runId)) return 'child';
  if (await spokenRun(db, scope.runId)) return 'voice';
  return null;
}

export function crewEditRefusal(db: Queryable, scope: RulesRunScope) {
  return rulesRunRefusal(db, scope, 'crew');
}

export const CREW_READ_REFUSALS: Record<CrewReadRefusedRun, string> = {
  remote:
    'A turn started on a paired device reads Sparks and workflows only while their cards can be answered from paired devices (Remote control on the Mac).',
  child: 'A Spark handed a job or working a workflow step does not read the crew.',
  voice: 'Sparks and workflows are not read for a spoken message. Type it on the Mac instead.',
};

export const CREW_EDIT_REFUSALS: Record<RulesRefusedRun, string> = {
  remote:
    'A turn started on a paired device changes Sparks and workflows only while their cards can be answered from paired devices (Remote control on the Mac).',
  voice:
    'Sparks and workflows are never changed from a spoken message. Type it on the Mac instead.',
  child: 'Only the chat’s own turn can ask to change a Spark or a workflow.',
  assistant: 'Ask Spark does not change Sparks or workflows. Ask in a chat on the Mac.',
  read_only: 'This turn is read-only, so it cannot change a Spark or a workflow.',
  no_chat: 'Sparks and workflows change only from a chat turn.',
};

export const CREW_HOW_TO: Record<CrewReadRefusedRun, string> = {
  remote:
    'spark_crew and spark_crew_edit (from a paired device only when Sparks and workflows cards can be answered there: Remote control on the Mac)',
  child:
    'spark_crew and spark_crew_edit (only in the chat’s own turn, not a Spark’s job or a workflow step)',
  voice: 'spark_crew and spark_crew_edit (never for a spoken message; type it on the Mac)',
};
