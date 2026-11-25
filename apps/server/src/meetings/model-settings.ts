import type {
  MeetingModelRunsOn,
  MeetingModelSettings,
  MeetingModelView,
  ProviderId,
} from '@spark-outpost/contracts';
import { BadRequestError } from '../api/validation.ts';
import { digestModelFor } from '../digest/service.ts';
import { cardFor } from '../model-cards/cards.ts';
import { getCapabilities } from '../persistence/chat-settings.ts';
import type { Db } from '../persistence/db.ts';
import { reportedEfforts } from '../providers/efforts.ts';

interface SettingsRow {
  provider: ProviderId | null;
  model: string | null;
  effort: string | null;
  default_provider: ProviderId | null;
}

const NOT_SET_UP = 'Finish setting up Spark first.';
const NOT_CONNECTED = 'Connect this provider before meetings use it.';

async function settingsRow(db: Db, workspaceId: string): Promise<SettingsRow | null> {
  const { rows } = await db.query<SettingsRow>(
    `SELECT meeting_provider AS provider, meeting_model AS model, meeting_effort AS effort,
       default_provider
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0] ?? null;
}

async function connectedProviders(db: Db, workspaceId: string): Promise<ProviderId[]> {
  const { rows } = await db.query<{ provider: ProviderId }>(
    `SELECT provider FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL ORDER BY provider`,
    [workspaceId],
  );
  return rows.map((row) => row.provider);
}

async function runsOn(
  db: Db,
  workspaceId: string,
  row: SettingsRow,
): Promise<MeetingModelRunsOn | null> {
  const connected = await connectedProviders(db, workspaceId);
  const chosen = row.provider && connected.includes(row.provider) ? row.provider : null;
  const fallback =
    row.default_provider && connected.includes(row.default_provider)
      ? row.default_provider
      : (connected[0] ?? null);
  const provider = chosen ?? fallback;
  if (!provider) return null;
  const fast = await digestModelFor(db, workspaceId, provider);
  const capabilities = await getCapabilities(db, workspaceId, provider);
  const offered = (capabilities?.models ?? []).filter((model) => model.availability !== 'unusable');
  const picked = row.provider === null || chosen ? row.model : null;
  const option = offered.find((model) => model.id === picked);
  const usesPick = picked !== null && (option !== undefined || offered.length === 0);
  const efforts = reportedEfforts(provider, capabilities?.efforts ?? null).map(
    (effort) => effort.id,
  );
  return {
    provider,
    model: usesPick ? picked : fast.model,
    modelLabel: usesPick
      ? option
        ? (cardFor(option, provider)?.label ?? option.label)
        : picked
      : fast.label,
    effort: row.effort && efforts.includes(row.effort) ? row.effort : fast.effort,
  };
}

export async function meetingRunsOn(
  db: Db,
  workspaceId: string,
): Promise<MeetingModelRunsOn | null> {
  const row = await settingsRow(db, workspaceId);
  return row ? runsOn(db, workspaceId, row) : null;
}

export async function meetingModelView(db: Db, workspaceId: string): Promise<MeetingModelView> {
  const row = await settingsRow(db, workspaceId);
  if (!row) return { settings: { provider: null, model: null, effort: null }, runsOn: null };
  return {
    settings: { provider: row.provider, model: row.model, effort: row.effort },
    runsOn: await runsOn(db, workspaceId, row),
  };
}

export async function saveMeetingModel(
  db: Db,
  workspaceId: string,
  settings: MeetingModelSettings,
): Promise<MeetingModelView> {
  if (
    settings.provider &&
    !(await connectedProviders(db, workspaceId)).includes(settings.provider)
  ) {
    throw new BadRequestError(NOT_CONNECTED);
  }
  const { rowCount } = await db.query(
    `UPDATE profiles SET meeting_provider = $2, meeting_model = $3, meeting_effort = $4,
       updated_at = now()
     WHERE workspace_id = $1`,
    [workspaceId, settings.provider, settings.model, settings.effort],
  );
  if (!rowCount) throw new BadRequestError(NOT_SET_UP);
  return meetingModelView(db, workspaceId);
}
