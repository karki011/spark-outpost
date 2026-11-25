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

function defaultProvider(row: SettingsRow, connected: ProviderId[]): ProviderId | null {
  return row.default_provider && connected.includes(row.default_provider)
    ? row.default_provider
    : (connected[0] ?? null);
}

async function runsOn(
  db: Db,
  workspaceId: string,
  row: SettingsRow,
): Promise<MeetingModelRunsOn | null> {
  const connected = await connectedProviders(db, workspaceId);
  const chosen = row.provider && connected.includes(row.provider) ? row.provider : null;
  const provider = chosen ?? defaultProvider(row, connected);
  if (!provider) return null;
  const fast = await digestModelFor(db, workspaceId, provider);
  const capabilities = await getCapabilities(db, workspaceId, provider);
  const reported = capabilities?.models ?? [];
  const mine = row.provider === null || chosen !== null;
  const picked = mine ? row.model : null;
  const option = reported.find((model) => model.id === picked && model.availability !== 'unusable');
  const usesPick = picked !== null && (option !== undefined || reported.length === 0);
  const efforts = reportedEfforts(provider, capabilities?.efforts ?? null).map(
    (effort) => effort.id,
  );
  const effort = mine && row.effort && efforts.includes(row.effort) ? row.effort : fast.effort;
  return {
    provider,
    model: usesPick ? picked : fast.model,
    modelLabel: usesPick
      ? option
        ? (cardFor(option, provider)?.label ?? option.label)
        : picked
      : fast.label,
    effort,
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

const NOT_OFFERED = 'This provider does not offer that model or effort. Pick again.';

async function assertOffered(
  db: Db,
  workspaceId: string,
  provider: ProviderId,
  settings: MeetingModelSettings,
): Promise<void> {
  const capabilities = await getCapabilities(db, workspaceId, provider);
  const models = capabilities?.models ?? [];
  const modelKnown =
    settings.model === null ||
    models.length === 0 ||
    models.some((model) => model.id === settings.model && model.availability !== 'unusable');
  const efforts = reportedEfforts(provider, capabilities?.efforts ?? null);
  const effortKnown =
    settings.effort === null || efforts.some((effort) => effort.id === settings.effort);
  if (!modelKnown || !effortKnown) throw new BadRequestError(NOT_OFFERED);
}

export async function saveMeetingModel(
  db: Db,
  workspaceId: string,
  settings: MeetingModelSettings,
): Promise<MeetingModelView> {
  const row = await settingsRow(db, workspaceId);
  if (!row) throw new BadRequestError(NOT_SET_UP);
  const connected = await connectedProviders(db, workspaceId);
  if (settings.provider && !connected.includes(settings.provider)) {
    throw new BadRequestError(NOT_CONNECTED);
  }
  const provider = settings.provider ?? defaultProvider(row, connected);
  if (provider) await assertOffered(db, workspaceId, provider, settings);
  await db.query(
    `UPDATE profiles SET meeting_provider = $2, meeting_model = $3, meeting_effort = $4,
       updated_at = now()
     WHERE workspace_id = $1`,
    [workspaceId, settings.provider, settings.model, settings.effort],
  );
  return meetingModelView(db, workspaceId);
}
