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
import type { Db, Queryable } from '../persistence/db.ts';

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
  alert_style: string;
  alert_lead: number;
  auto_join: boolean;
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
    alertStyle: row.alert_style,
    alertLead: row.alert_lead,
    autoJoin: row.auto_join,
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

async function ensureConnection(db: Queryable, workspaceId: string): Promise<void> {
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

export async function setNotice(db: Queryable, workspaceId: string, notice: string | null) {
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
  agentsRead: 'agents_read',
  alertStyle: 'alert_style',
  alertLead: 'alert_lead',
  autoJoin: 'auto_join',
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
  agents_edit: boolean;
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
    agentsEdit: row.agents_edit,
  };
}

export type ChoiceOwner = { googleAccountId: string | null };

export const EVENTKIT_OWNER: ChoiceOwner = { googleAccountId: null };

export async function savedChoices(
  db: Queryable,
  workspaceId: string,
  owner?: ChoiceOwner,
): Promise<CalendarChoice[]> {
  const scoped = owner !== undefined;
  const { rows } = await db.query<ChoiceRow>(
    `SELECT * FROM calendar_calendars
     WHERE workspace_id = $1
       AND (NOT $2 OR google_account_id IS NOT DISTINCT FROM $3)
     ORDER BY google_account_id IS NOT NULL, google_account_id, position, title, key`,
    [workspaceId, scoped, owner?.googleAccountId ?? null],
  );
  return rows.map(choiceOf);
}

export interface ChoiceWrite {
  key: string | null;
  calendar: HelperCalendar;
  include: boolean;
  nudges: boolean;
  agentsEdit: boolean;
}

export async function lockChoices(
  client: Queryable,
  workspaceId: string,
  owner: ChoiceOwner,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `calendar_calendars:${workspaceId}:${owner.googleAccountId ?? 'eventkit'}`,
  ]);
}

export async function replaceChoices(
  client: Queryable,
  workspaceId: string,
  writes: readonly ChoiceWrite[],
  owner: ChoiceOwner,
): Promise<void> {
  await client.query(
    `DELETE FROM calendar_calendars
     WHERE workspace_id = $1 AND google_account_id IS NOT DISTINCT FROM $2`,
    [workspaceId, owner.googleAccountId],
  );
  for (const [position, write] of writes.entries()) {
    const { calendar } = write;
    await client.query(
      `INSERT INTO calendar_calendars (key, workspace_id, calendar_id, title, source_id,
         source_title, source_kind, color, writable, subscribed, ownership, include, nudges,
         position, google_account_id, agents_edit)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
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
        position,
        owner.googleAccountId,
        write.agentsEdit && calendar.writable,
      ],
    );
  }
}

const CHOICE_COLUMNS: Record<keyof CalendarChoicePatch, string> = {
  include: 'include',
  nudges: 'nudges',
  agentsEdit: 'agents_edit',
};

export async function updateChoice(
  db: Db,
  workspaceId: string,
  key: string,
  patch: CalendarChoicePatch,
): Promise<boolean> {
  const entries = Object.entries(patch) as [keyof CalendarChoicePatch, boolean][];
  const sets = entries.map(([name], index) => `${CHOICE_COLUMNS[name]} = $${index + 3}`);
  const googleMayEdit = patch.agentsEdit
    ? `AND (google_account_id IS NULL OR EXISTS (
         SELECT 1 FROM calendar_google_accounts account
         WHERE account.id = calendar_calendars.google_account_id AND account.can_edit))`
    : '';
  const { rowCount } = await db.query(
    `UPDATE calendar_calendars SET ${sets.length ? sets.join(', ') : 'include = include'}
     WHERE workspace_id = $1 AND key = $2 ${googleMayEdit}`,
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
  const marks = { remind: new Set<string>(), hold: new Set<string>(), dismissed: new Set<string>() };
  const byKind: Record<CalendarMarkKind, Set<string>> = {
    remind_5: marks.remind,
    hold: marks.hold,
    dismiss: marks.dismissed,
  };
  for (const row of rows) {
    byKind[row.kind]?.add(`${row.uid}@${row.occurrence_start.toISOString()}`);
  }
  return marks;
}

export async function forgetMarksOf(
  db: Db,
  workspaceId: string,
  uids: readonly string[],
): Promise<void> {
  if (uids.length === 0) return;
  await db.query('DELETE FROM calendar_marks WHERE workspace_id = $1 AND uid = ANY($2)', [
    workspaceId,
    uids,
  ]);
}

export async function forgetMarks(db: Db, workspaceId: string): Promise<void> {
  await db.query('DELETE FROM calendar_marks WHERE workspace_id = $1', [workspaceId]);
}
