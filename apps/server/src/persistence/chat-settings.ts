import type {
  CapabilityOption,
  InvolvementLevel,
  ChatSettings,
  ModelRouting,
  ProviderCapabilities,
  ProviderId,
  UpdateChatSettingsRequest,
} from '@spark-outpost/contracts';
import { effectiveDefaultModel } from '../model-cards/cards.ts';
import { catalogEntry, isSelectablePermission } from '../providers/catalog.ts';
import type { Queryable } from './db.ts';
import { InvalidDefaultError } from './setup.ts';

interface ProviderChoices {
  model?: string;
  effort?: string;
  permission?: string;
  level?: InvolvementLevel;
}

type Overrides = Partial<Record<ProviderId, ProviderChoices>>;

interface SettingsRow {
  workspace_id: string;
  provider: ProviderId | null;
  model_routing?: ModelRouting | undefined;
  overrides: Overrides;
  default_provider: ProviderId | null;
}

interface ConnectionDefaults {
  provider: ProviderId;
  model: string | null;
  effort: string;
  permission: string;
  level: InvolvementLevel;
}

const EMPTY: ChatSettings = {
  provider: null,
  model: null,
  effort: null,
  permission: null,
  level: null,
};

export class ConversationMissingError extends Error {}

async function settingsRow(db: Queryable, conversationId: string): Promise<SettingsRow> {
  const { rows } = await db.query<SettingsRow>(
    `SELECT c.workspace_id, c.provider, c.overrides, c.model_routing, p.default_provider
     FROM conversations c LEFT JOIN profiles p ON p.workspace_id = c.workspace_id
     WHERE c.id = $1`,
    [conversationId],
  );
  const row = rows[0];
  if (!row) throw new ConversationMissingError(conversationId);
  return row;
}

async function connectionDefaults(
  db: Queryable,
  workspaceId: string,
): Promise<Map<ProviderId, ConnectionDefaults>> {
  const { rows } = await db.query<ConnectionDefaults>(
    `SELECT provider, model, effort, permission, level FROM provider_connections
     WHERE workspace_id = $1 AND disconnected_at IS NULL ORDER BY provider`,
    [workspaceId],
  );
  return new Map(rows.map((row) => [row.provider, row]));
}

export function effectiveSettings(
  row: Omit<SettingsRow, 'workspace_id'>,
  connections: ReadonlyMap<ProviderId, ConnectionDefaults>,
): ChatSettings {
  const pick = (id: ProviderId | null) => (id && connections.has(id) ? id : null);
  const provider =
    pick(row.provider) ?? pick(row.default_provider) ?? connections.keys().next().value ?? null;
  if (!provider) return EMPTY;
  const connection = connections.get(provider)!;
  const chosen = row.overrides[provider] ?? {};
  return {
    provider,
    model: chosen.model ?? connection.model,
    effort: chosen.effort ?? connection.effort,
    permission: chosen.permission ?? connection.permission,
    level: chosen.level ?? connection.level,
    ...(row.model_routing ? { routing: row.model_routing } : {}),
  };
}

export async function resolveChatSettings(
  db: Queryable,
  conversationId: string,
): Promise<ChatSettings> {
  const row = await settingsRow(db, conversationId);
  return effectiveSettings(row, await connectionDefaults(db, row.workspace_id));
}

export async function draftChatSettings(db: Queryable, workspaceId: string): Promise<ChatSettings> {
  const { rows } = await db.query<{ default_provider: ProviderId | null }>(
    'SELECT default_provider FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return effectiveSettings(
    { provider: null, overrides: {}, default_provider: rows[0]?.default_provider ?? null },
    await connectionDefaults(db, workspaceId),
  );
}

export async function updateChatSettings(
  db: Queryable,
  conversationId: string,
  update: UpdateChatSettingsRequest,
): Promise<ChatSettings> {
  const row = await settingsRow(db, conversationId);
  const connections = await connectionDefaults(db, row.workspace_id);
  const current = effectiveSettings(row, connections);
  const provider = update.provider ?? current.provider;
  if (!provider || !connections.has(provider)) {
    throw new InvalidDefaultError('Connect this provider before using it in a chat.');
  }
  if (update.permission && !isSelectablePermission(catalogEntry(provider), update.permission)) {
    const choice = catalogEntry(provider).permissions.find((c) => c.id === update.permission);
    throw new InvalidDefaultError(choice?.unavailableReason ?? 'That permission mode is unknown.');
  }
  const choices: ProviderChoices = { ...row.overrides[provider] };
  for (const key of ['model', 'effort', 'permission'] as const) {
    const value = update[key];
    if (value === undefined) continue;
    if (value === null) delete choices[key];
    else choices[key] = value;
  }
  if (update.level === null) delete choices.level;
  else if (update.level !== undefined) choices.level = update.level;
  const overrides: Overrides = { ...row.overrides, [provider]: choices };
  const routing = update.routing ?? row.model_routing;
  await db.query(
    `UPDATE conversations SET provider = $2, overrides = $3,
       model_routing = COALESCE($4, model_routing)
     WHERE id = $1`,
    [conversationId, provider, JSON.stringify(overrides), update.routing ?? null],
  );
  return effectiveSettings(
    { provider, overrides, default_provider: row.default_provider, model_routing: routing },
    connections,
  );
}

export interface CapabilitySnapshot {
  provider: ProviderId;
  models: CapabilityOption[];
  efforts: CapabilityOption[];
  defaultModel: string | null;
}

export async function saveCapabilities(
  db: Queryable,
  workspaceId: string,
  snapshot: CapabilitySnapshot,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_capabilities (workspace_id, provider, models, efforts, default_model)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       models = EXCLUDED.models, efforts = EXCLUDED.efforts,
       default_model = EXCLUDED.default_model, captured_at = now()`,
    [
      workspaceId,
      snapshot.provider,
      JSON.stringify(snapshot.models),
      JSON.stringify(snapshot.efforts),
      snapshot.defaultModel,
    ],
  );
}

export async function getCapabilities(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<ProviderCapabilities | null> {
  const { rows } = await db.query<{
    models: CapabilityOption[];
    efforts: CapabilityOption[];
    default_model: string | null;
    captured_at: Date;
  }>(
    `SELECT models, efforts, default_model, captured_at FROM provider_capabilities
     WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    provider,
    models: row.models,
    efforts: row.efforts,
    defaultModel: effectiveDefaultModel(provider, row.models, row.default_model),
    agentDefaultModel: row.default_model,
    capturedAt: row.captured_at.toISOString(),
  };
}
