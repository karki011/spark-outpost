import type { Db } from '../../../persistence/db.ts';
import { childRun } from '../../../mac-control/offered.ts';
import { runFromDevice } from '../../../remote/run-mark.ts';
import { googleAccounts } from '../../../calendar/google/store.ts';
import { calendarConnection, savedChoices } from '../../../calendar/store.ts';
import type { SparkScope, SparkToolDeps } from '../../deps.ts';

export type CalendarRefusedRun = 'no_shell' | 'no_chat' | 'remote' | 'child';

export async function calendarRunRefusal(
  deps: Pick<SparkToolDeps, 'db' | 'calendar'>,
  scope: Pick<SparkScope, 'conversationId' | 'runId'>,
): Promise<CalendarRefusedRun | null> {
  if (!deps.calendar) return 'no_shell';
  if (!scope.conversationId) return 'no_chat';
  if (!scope.runId) return null;
  if (await runFromDevice(deps.db, scope.runId)) return 'remote';
  if (await childRun(deps.db, scope.runId)) return 'child';
  return null;
}

async function connected(
  db: Db,
  workspaceId: string,
  macHost: boolean,
): Promise<{ any: boolean; agentsRead: boolean }> {
  const connection = await calendarConnection(db, workspaceId);
  const mac = macHost && connection.connected;
  const google = (await googleAccounts(db, workspaceId)).length > 0;
  return { any: mac || google, agentsRead: connection.settings.agentsRead };
}

export interface CalendarOffer {
  read: boolean;
  edit: boolean;
}

const NOTHING: CalendarOffer = { read: false, edit: false };

export async function calendarOffer(
  deps: SparkToolDeps,
  scope: SparkScope,
): Promise<CalendarOffer> {
  if ((await calendarRunRefusal(deps, scope)) !== null) return NOTHING;
  const calendar = deps.calendar!;
  const state = await connected(deps.db, scope.workspaceId, calendar.host !== null);
  if (!state.any) return NOTHING;
  const choices = await savedChoices(deps.db, scope.workspaceId);
  return {
    read: state.agentsRead,
    edit: !scope.readOnly && choices.some((choice) => choice.agentsEdit && choice.writable),
  };
}
