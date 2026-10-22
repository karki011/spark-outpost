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

export const CALENDAR_CARD = 'Settings → Connectors → Calendar';

export const CALENDAR_HOW_TO = {
  connect: `spark_calendar and spark_calendar_edit (connect a calendar in ${CALENDAR_CARD}; reading also needs Let agents read my calendar on, on that card)`,
  read: `spark_calendar (turn on Let agents read my calendar on the Calendar card in ${CALENDAR_CARD})`,
  edit: `spark_calendar_edit (turn on Agents can edit for a calendar on the Calendar card in ${CALENDAR_CARD})`,
  remote:
    'spark_calendar and spark_calendar_edit (not in a turn started from a paired device; ask from the Mac)',
} as const;

export interface CalendarOffer {
  read: boolean;
  edit: boolean;
  howTo: { read?: string; edit?: string };
}

function nothing(howTo: CalendarOffer['howTo'] = {}): CalendarOffer {
  return { read: false, edit: false, howTo };
}

function refusalHowTo(refused: CalendarRefusedRun): CalendarOffer['howTo'] {
  return refused === 'remote' ? { read: CALENDAR_HOW_TO.remote } : {};
}

export async function calendarOffer(
  deps: SparkToolDeps,
  scope: SparkScope,
): Promise<CalendarOffer> {
  const refused = await calendarRunRefusal(deps, scope);
  if (refused !== null) return nothing(refusalHowTo(refused));
  const calendar = deps.calendar!;
  const state = await connected(deps.db, scope.workspaceId, calendar.host !== null);
  if (!state.any) return nothing({ read: CALENDAR_HOW_TO.connect });
  const choices = await savedChoices(deps.db, scope.workspaceId);
  const mayAct = scope.assistant === true || scope.readOnly !== true;
  const edit = mayAct && choices.some((choice) => choice.agentsEdit && choice.writable);
  return {
    read: state.agentsRead,
    edit,
    howTo: {
      ...(state.agentsRead ? {} : { read: CALENDAR_HOW_TO.read }),
      ...(edit || !mayAct ? {} : { edit: CALENDAR_HOW_TO.edit }),
    },
  };
}

export async function meetingsOffer(deps: SparkToolDeps, scope: SparkScope): Promise<boolean> {
  if (!deps.calendar || !scope.assistant || !scope.runId) return false;
  if (await runFromDevice(deps.db, scope.runId)) return false;
  if (await childRun(deps.db, scope.runId)) return false;
  return (await connected(deps.db, scope.workspaceId, deps.calendar.host !== null)).any;
}
