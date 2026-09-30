import {
  DEFAULT_INVOLVEMENT_LEVEL,
  defaultModeFor,
  permissionFor,
  type AgentModeOption,
  type CapabilityOption,
  type ConfigOptionInfo,
  type ConfigValues,
  type InvolvementLevel,
  type ChatSettings,
  type ModelRouting,
  type ProviderCapabilities,
  type ProviderId,
  type UpdateChatSettingsRequest,
} from '@spark-outpost/contracts';
import { cardFor, effectiveDefaultModel, usableDefault } from '../model-cards/cards.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { firstReportedEffort, reportedEfforts } from '../providers/efforts.ts';
import type { Queryable } from './db.ts';
import { assertModeOffered, InvalidDefaultError } from './setup.ts';

interface ProviderChoices {
  model?: string;
  effort?: string;
  agentMode?: string;
  level?: InvolvementLevel;
  options?: ConfigValues;
}

type Overrides = Partial<Record<ProviderId, ProviderChoices>>;

interface SettingsRow {
  workspace_id: string;
  provider: ProviderId | null;
  model_routing?: ModelRouting | undefined;
  overrides: Overrides;
  default_provider: ProviderId | null;
  default_level: InvolvementLevel | null;
}

interface ConnectionDefaults {
  provider: ProviderId;
  model: string | null;
  effort: string | null;
  agentMode: string | null;
  modes: AgentModeOption[];
  options: ConfigOptionInfo[];
}

const NO_CHAT_SETTINGS: ChatSettings = {
  provider: null,
  model: null,
  effort: null,
  permission: null,
  agentMode: null,
  level: null,
  options: {},
};

export class ConversationMissingError extends Error {}

async function settingsRow(db: Queryable, conversationId: string): Promise<SettingsRow> {
  const { rows } = await db.query<SettingsRow>(
    `SELECT c.workspace_id, c.provider, c.overrides, c.model_routing, p.default_provider,
       p.default_level
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
  const { rows } = await db.query<
    Omit<ConnectionDefaults, 'modes' | 'options'> & {
      reported: CapabilityOption[] | null;
      modes: AgentModeOption[] | null;
      options: ConfigOptionInfo[] | null;
    }
  >(
    `SELECT pc.provider, pc.model, pc.effort, pc.agent_mode AS "agentMode",
       cap.efforts AS reported, cap.modes, cap.config_options AS options
     FROM provider_connections pc
     LEFT JOIN provider_capabilities cap
       ON cap.workspace_id = pc.workspace_id AND cap.provider = pc.provider
     WHERE pc.workspace_id = $1 AND pc.disconnected_at IS NULL ORDER BY pc.provider`,
    [workspaceId],
  );
  return new Map(
    rows.map(({ reported, modes, options, ...row }) => {
      const offered = reportedEfforts(row.provider, reported).map((option) => option.id);
      return [
        row.provider,
        {
          ...row,
          model: usableDefault(row.provider, row.model),
          effort: firstReportedEffort([row.effort], offered),
          modes: modes ?? [],
          options: options ?? [],
        },
      ];
    }),
  );
}

function effectiveSettings(
  row: Omit<SettingsRow, 'workspace_id'>,
  connections: ReadonlyMap<ProviderId, ConnectionDefaults>,
): ChatSettings {
  const pick = (id: ProviderId | null) => (id && connections.has(id) ? id : null);
  const provider =
    pick(row.provider) ?? pick(row.default_provider) ?? connections.keys().next().value ?? null;
  if (!provider) return NO_CHAT_SETTINGS;
  const connection = connections.get(provider)!;
  const chosen = row.overrides[provider] ?? {};
  const agentMode = chosen.agentMode ?? connection.agentMode ?? defaultModeFor(provider);
  return {
    provider,
    model: chosen.model ?? connection.model,
    effort: chosen.effort ?? connection.effort,
    permission: permissionFor(provider, agentMode, connection.modes),
    agentMode,
    level: chosen.level ?? row.default_level ?? DEFAULT_INVOLVEMENT_LEVEL,
    options: chosen.options ?? {},
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
  const { rows } = await db.query<Pick<SettingsRow, 'default_provider' | 'default_level'>>(
    'SELECT default_provider, default_level FROM profiles WHERE workspace_id = $1',
    [workspaceId],
  );
  return effectiveSettings(
    {
      provider: null,
      overrides: {},
      default_provider: rows[0]?.default_provider ?? null,
      default_level: rows[0]?.default_level ?? null,
    },
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
  const connection = connections.get(provider)!;
  if (update.agentMode) assertModeOffered(provider, update.agentMode, connection.modes);
  if (update.options) assertOptionsOffered(provider, update.options, connection.options);
  const choices: ProviderChoices = { ...row.overrides[provider] };
  for (const key of ['model', 'effort', 'agentMode'] as const) {
    const value = update[key];
    if (value === undefined) continue;
    if (value === null) delete choices[key];
    else choices[key] = value;
  }
  if (update.level === null) delete choices.level;
  else if (update.level !== undefined) choices.level = update.level;
  if (update.options) choices.options = { ...choices.options, ...update.options };
  const overrides: Overrides = { ...row.overrides, [provider]: choices };
  const routing = update.routing ?? row.model_routing;
  await db.query(
    `UPDATE conversations SET provider = $2, overrides = $3,
       model_routing = COALESCE($4, model_routing)
     WHERE id = $1`,
    [conversationId, provider, JSON.stringify(overrides), update.routing ?? null],
  );
  return effectiveSettings(
    {
      provider,
      overrides,
      default_provider: row.default_provider,
      default_level: row.default_level,
      model_routing: routing,
    },
    connections,
  );
}

function assertOptionsOffered(
  provider: ProviderId,
  values: ConfigValues,
  options: readonly ConfigOptionInfo[],
): void {
  for (const [id, value] of Object.entries(values)) {
    const option = options.find((candidate) => candidate.id === id);
    const fits =
      option?.type === 'boolean'
        ? typeof value === 'boolean'
        : option?.type === 'select' && option.choices.some((choice) => choice.id === value);
    if (!fits) {
      throw new InvalidDefaultError(`${catalogEntry(provider).name} doesn't offer that option.`);
    }
  }
}

export interface CapabilitySnapshot {
  provider: ProviderId;
  models: CapabilityOption[];
  efforts: CapabilityOption[];
  defaultModel: string | null;
  modes?: AgentModeOption[];
  defaultMode?: string | null;
  options?: ConfigOptionInfo[];
}

export async function saveCapabilities(
  db: Queryable,
  workspaceId: string,
  snapshot: CapabilitySnapshot,
): Promise<void> {
  await db.query(
    `INSERT INTO provider_capabilities
       (workspace_id, provider, models, efforts, default_model, modes, default_mode, config_options)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       models = EXCLUDED.models, efforts = EXCLUDED.efforts,
       default_model = EXCLUDED.default_model, modes = EXCLUDED.modes,
       default_mode = EXCLUDED.default_mode, config_options = EXCLUDED.config_options,
       captured_at = now()`,
    [
      workspaceId,
      snapshot.provider,
      JSON.stringify(snapshot.models),
      JSON.stringify(snapshot.efforts),
      snapshot.defaultModel,
      JSON.stringify(snapshot.modes ?? []),
      snapshot.defaultMode ?? null,
      JSON.stringify(snapshot.options ?? []),
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
    modes: AgentModeOption[];
    default_mode: string | null;
    config_options: ConfigOptionInfo[];
    captured_at: Date;
  }>(
    `SELECT models, efforts, default_model, modes, default_mode, config_options, captured_at
     FROM provider_capabilities WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    provider,
    models: row.models.map((model) => {
      const card = cardFor(model, provider);
      return {
        ...model,
        retiresNotBefore: card?.retiresNotBefore ?? null,
        ...(card?.retired ? { retired: true } : {}),
      };
    }),
    efforts: row.efforts,
    defaultModel: effectiveDefaultModel(provider, row.models, row.default_model),
    agentDefaultModel: row.default_model,
    modes: row.modes,
    defaultMode: defaultModeFor(provider) ?? row.default_mode,
    options: row.config_options,
    capturedAt: row.captured_at.toISOString(),
  };
}
