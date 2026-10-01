import {
  permissionFor,
  type AgentModeOption,
  type CapabilityOption,
  type ProviderConnection,
  type ProviderId,
} from '@spark-outpost/contracts';
import { retirementOf, retirementText, type Retirement } from '../model-cards/cards.ts';
import { catalogEntry } from '../providers/catalog.ts';
import { reportedEfforts } from '../providers/efforts.ts';
import type { Queryable } from './db.ts';
import {
  assertModeOffered,
  connectionRows,
  InvalidDefaultError,
  toConnection,
  type ConnectionRow,
} from './setup.ts';

interface CapturedOptions {
  models: CapabilityOption[];
  efforts: CapabilityOption[];
  modes: AgentModeOption[];
}

async function capabilityOptions(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<CapturedOptions | null> {
  const { rows } = await db.query<CapturedOptions>(
    `SELECT models, efforts, modes FROM provider_capabilities
     WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
  return rows[0] ?? null;
}

async function offersModel(
  db: Queryable,
  workspaceId: string,
  connection: ConnectionRow,
  model: string,
): Promise<boolean> {
  if (connection.models.some((option) => option.id === model)) return true;
  const captured = await capabilityOptions(db, workspaceId, connection.provider);
  return captured?.models.some((option) => option.id === model) ?? false;
}

async function reportsEffort(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  effort: string,
): Promise<boolean> {
  const captured = await capabilityOptions(db, workspaceId, provider);
  return reportedEfforts(provider, captured?.efforts ?? null).some(
    (option) => option.id === effort,
  );
}

function retiringModel(connection: ConnectionRow, model: string): Retirement | null {
  const listed = connection.models.find((option) => option.id === model) ?? { id: model };
  return retirementOf(listed, connection.provider);
}

export async function updateProviderDefaults(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  update: {
    model?: string | undefined;
    agentMode?: string | undefined;
    effort?: string | null | undefined;
  },
): Promise<ProviderConnection> {
  const entry = catalogEntry(provider);
  const current = (await connectionRows(db, workspaceId)).find(
    (row) => row.provider === provider && !row.disconnected_at,
  );
  if (!current)
    throw new InvalidDefaultError(`Connect ${entry.name} before changing its defaults.`);
  if (update.model && !(await offersModel(db, workspaceId, current, update.model))) {
    throw new InvalidDefaultError(`${entry.name} does not offer that model.`);
  }
  const retiring = update.model ? retiringModel(current, update.model) : null;
  if (retiring) {
    throw new InvalidDefaultError(
      `That model ${retirementText(retiring, 'retires')}, so it can't be the default. Pick it in a chat instead.`,
    );
  }
  const modes = update.agentMode
    ? ((await capabilityOptions(db, workspaceId, provider))?.modes ?? [])
    : [];
  if (update.agentMode) assertModeOffered(provider, update.agentMode, modes);
  if (update.effort && !(await reportsEffort(db, workspaceId, provider, update.effort))) {
    throw new InvalidDefaultError(`${entry.name} does not have that effort level.`);
  }
  const { rows } = await db.query<ConnectionRow>(
    `UPDATE provider_connections SET
       model = COALESCE($3, model),
       permission = COALESCE($4, permission),
       effort = CASE WHEN $6 THEN $5 ELSE effort END,
       agent_mode = COALESCE($7, agent_mode)
     WHERE workspace_id = $1 AND provider = $2
     RETURNING *`,
    [
      workspaceId,
      provider,
      update.model ?? null,
      update.agentMode ? permissionFor(provider, update.agentMode, modes) : null,
      update.effort ?? null,
      update.effort !== undefined,
      update.agentMode ?? null,
    ],
  );
  return toConnection(rows[0])!;
}
