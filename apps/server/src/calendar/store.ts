import { randomUUID } from 'node:crypto';
import {
  CALENDAR_DEFAULT_SETTINGS,
  calendarSettingsSchema,
  type CalendarChoice,
  type CalendarChoicePatch,
  type CalendarMarkKind,
  type CalendarMarks,
  type CalendarSettings,
  type CalendarSettingsPatch,
  type HelperCalendar,
} from '@spark-outpost/contracts';
import { withTransaction, type Db } from '../persistence/db.ts';

export interface CalendarConnection {
  connected: boolean;
  notice: string | null;
  settings: CalendarSettings;
}

interface ConnectionRow {
  connected: boolean;
  before_minutes: number;
  wrap_up_minutes: number;
  capture: boolean;
  hold_rule: string;
  focus_names: string[];
  phone_alerts: boolean;
  brief_block: boolean;
  agents_read: boolean;
  notice: string | null;
}

function settingsOf(row: ConnectionRow): CalendarSettings {
  const parsed = calendarSettingsSchema.safeParse({
    beforeMinutes: row.before_minutes,
    wrapUpMinutes: row.wrap_up_minutes,
    capture: row.capture,
    holdRule: row.hold_rule,
    focusNames: row.focus_names,
    phoneAlerts: row.phone_alerts,
    briefBlock: row.brief_block,
    agentsRead: row.agents_read,
  });
  return parsed.success ? parsed.data : CALENDAR_DEFAULT_SETTINGS;
}

export async function calendarConnection(db: Db, workspaceId: string): Promise<CalendarConnection> {
  const { rows } = await db.query<ConnectionRow>(
    'SELECT * FROM calendar_connection WHERE workspace_id = $1',
    [workspaceId],
  );
  const row = rows[0];
  if (!row) return { connected: false, notice: null, settings: CALENDAR_DEFAULT_SETTINGS };
  return { connected: row.connected, notice: row.notice, settings: settingsOf(row) };
}

async function ensureConnection(db: Db, workspaceId: string): Promise<void> {
  await db.query(
    'INSERT INTO calendar_connection (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [workspaceId],
  );
}

export async function setConnected(db: Db, workspaceId: string, connected: boolean) {
  await ensureConnection(db, workspaceId);
  await db.query(
    `UPDATE calendar_connection SET connected = $2, notice = NULL, updated_at = now()
     WHERE workspace_id = $1`,
    [workspaceId, connected],
  );
}

export async function setNotice(db: Db, workspaceId: string, notice: string | null) {
  await ensureConnection(db, workspaceId);
  await db.query('UPDATE calendar_connection SET notice = $2 WHERE workspace_id = $1', [
    workspaceId,
    notice,
  ]);
}

const SETTING_COLUMNS: Record<keyof CalendarSettingsPatch, string> = {
  beforeMinutes: 'before_minutes',
  wrapUpMinutes: 'wrap_up_minutes',
  capture: 'capture',
  holdRule: 'hold_rule',
  focusNames: 'focus_names',
  phoneAlerts: 'phone_alerts',
  briefBlock: 'brief_block',
};

export async function updateSettings(
  db: Db,
  workspaceId: string,
  patch: CalendarSettingsPatch,
): Promise<CalendarSettings> {
  await ensureConnection(db, workspaceId);
  const entries = Object.entries(patch) as [keyof CalendarSettingsPatch, unknown][];
  if (entries.length > 0) {
    const sets = entries.map(([key], index) => `${SETTING_COLUMNS[key]} = $${index + 2}`);
    await db.query(
      `UPDATE calendar_connection SET ${sets.join(', ')}, updated_at = now() WHERE workspace_id = $1`,
      [workspaceId, ...entries.map(([, value]) => value)],
    );
  }
  return (await calendarConnection(db, workspaceId)).settings;
}

interface ChoiceRow {
  key: string;
  calendar_id: string;
  title: string;
  source_id: string;
  source_title: string;
  source_kind: CalendarChoice['sourceKind'];
  color: string;
  writable: boolean;
  subscribed: boolean;
  ownership: CalendarChoice['ownership'];
  include: boolean;
  nudges: boolean;
  busy: boolean;
}

function choiceOf(row: ChoiceRow): CalendarChoice {
  return {
    key: row.key,
    calendarId: row.calendar_id,
    title: row.title,
    sourceId: row.source_id,
    sourceTitle: row.source_title,
    sourceKind: row.source_kind,
    color: row.color,
    writable: row.writable,
    subscribed: row.subscribed,
    ownership: row.ownership,
    include: row.include,
    nudges: row.nudges,
    busy: row.busy,
  };
}

export async function savedChoices(db: Db, workspaceId: string): Promise<CalendarChoice[]> {
  const { rows } = await db.query<ChoiceRow>(
    'SELECT * FROM calendar_calendars WHERE workspace_id = $1 ORDER BY position, title, key',
    [workspaceId],
  );
  return rows.map(choiceOf);
}

export interface ChoiceWrite {
  key: string | null;
  calendar: HelperCalendar;
  include: boolean;
  nudges: boolean;
  busy: boolean;
}

export async function replaceChoices(
  db: Db,
  workspaceId: string,
  writes: readonly ChoiceWrite[],
): Promise<void> {
  await withTransaction(db, async (client) => {
    await client.query('DELETE FROM calendar_calendars WHERE workspace_id = $1', [workspaceId]);
    for (const [position, write] of writes.entries()) {
      const { calendar } = write;
      await client.query(
        `INSERT INTO calendar_calendars (key, workspace_id, calendar_id, title, source_id,
           source_title, source_kind, color, writable, subscribed, ownership, include, nudges,
           busy, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          write.key ?? randomUUID(),
          workspaceId,
          calendar.id,
          calendar.title,
          calendar.sourceId,
          calendar.sourceTitle,
          calendar.sourceKind,
          calendar.color,
          calendar.writable,
          calendar.subscribed,
          calendar.ownership,
          write.include,
          write.nudges,
          write.busy,
          position,
        ],
      );
    }
  });
}

const CHOICE_COLUMNS: Record<keyof CalendarChoicePatch, string> = {
  include: 'include',
  nudges: 'nudges',
  busy: 'busy',
};

export async function updateChoice(
  db: Db,
  workspaceId: string,
  key: string,
  patch: CalendarChoicePatch,
): Promise<boolean> {
  const entries = Object.entries(patch) as [keyof CalendarChoicePatch, boolean][];
  const sets = entries.map(([name], index) => `${CHOICE_COLUMNS[name]} = $${index + 3}`);
  const { rowCount } = await db.query(
    `UPDATE calendar_calendars SET ${sets.length ? sets.join(', ') : 'include = include'}
     WHERE workspace_id = $1 AND key = $2`,
    [workspaceId, key, ...entries.map(([, value]) => value)],
  );
  return (rowCount ?? 0) > 0;
}

export function splitEventKey(eventKey: string): { uid: string; start: Date } | null {
  const at = eventKey.lastIndexOf('@');
  if (at <= 0) return null;
  const start = new Date(eventKey.slice(at + 1));
  if (Number.isNaN(start.getTime())) return null;
  return { uid: eventKey.slice(0, at), start };
}

export async function setMark(
  db: Db,
  workspaceId: string,
  mark: { eventKey: string; end: string; kind: CalendarMarkKind; on: boolean },
): Promise<boolean> {
  const parts = splitEventKey(mark.eventKey);
  if (!parts) return false;
  if (mark.on) {
    await db.query(
      `INSERT INTO calendar_marks (workspace_id, uid, occurrence_start, kind, ends_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, uid, occurrence_start, kind) DO UPDATE SET ends_at = $5`,
      [workspaceId, parts.uid, parts.start, mark.kind, new Date(mark.end)],
    );
  } else {
    await db.query(
      `DELETE FROM calendar_marks
       WHERE workspace_id = $1 AND uid = $2 AND occurrence_start = $3 AND kind = $4`,
      [workspaceId, parts.uid, parts.start, mark.kind],
    );
  }
  return true;
}

export const MARK_PURGE_MS = 60 * 60_000;

export async function calendarMarks(
  db: Db,
  workspaceId: string,
  now: Date,
): Promise<CalendarMarks> {
  await db.query('DELETE FROM calendar_marks WHERE workspace_id = $1 AND ends_at < $2', [
    workspaceId,
    new Date(now.getTime() - MARK_PURGE_MS),
  ]);
  const { rows } = await db.query<{ uid: string; occurrence_start: Date; kind: CalendarMarkKind }>(
    'SELECT uid, occurrence_start, kind FROM calendar_marks WHERE workspace_id = $1',
    [workspaceId],
  );
  const remind = new Set<string>();
  const hold = new Set<string>();
  for (const row of rows) {
    const key = `${row.uid}@${row.occurrence_start.toISOString()}`;
    (row.kind === 'hold' ? hold : remind).add(key);
  }
  return { remind, hold };
}

export async function forgetMarks(db: Db, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM calendar_marks WHERE workspace_id = $1', [workspaceId]);
}
