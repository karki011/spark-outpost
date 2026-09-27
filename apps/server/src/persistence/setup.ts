import type {
  CapabilityOption,
  InvolvementLevel,
  Profile,
  ProviderConnection,
  ProviderId,
  ProviderModel,
  ProviderSetup,
  SetupState,
  UpdateProfileRequest,
} from '@spark-outpost/contracts';
import { effectiveDefaultModel } from '../model-cards/cards.ts';
import { catalog, catalogEntry, isSelectablePermission } from '../providers/catalog.ts';
import { reportedEfforts } from '../providers/efforts.ts';
import type { TestOutcome } from '../setup/test-message.ts';
import type { VerifiedConnection } from '../setup/verify.ts';
import { listAdvisors } from './advisors.ts';
import type { Queryable } from './db.ts';

interface ProfileRow {
  display_name: string;
  default_provider: ProviderId | null;
  onboarding_completed_at: Date | null;
  auto_continue_seconds: number | null;
  jev_diffs: boolean;
}

interface ConnectionRow {
  provider: ProviderId;
  method: 'cli' | 'api_key';
  detail: string;
  models: ProviderModel[];
  model: string | null;
  permission: string;
  level: InvolvementLevel;
  effort: string | null;
  verified_at: Date;
  disconnected_at: Date | null;
  summary: string | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
}

export class InvalidDefaultError extends Error {}

async function ensureProfile(db: Queryable, workspaceId: string): Promise<ProfileRow> {
  await db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    workspaceId,
  ]);
  const { rows } = await db.query<ProfileRow>(
    `SELECT display_name, default_provider, onboarding_completed_at, auto_continue_seconds,
       jev_diffs
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0]!;
}

async function connectionRows(db: Queryable, workspaceId: string): Promise<ConnectionRow[]> {
  const { rows } = await db.query<ConnectionRow>(
    'SELECT * FROM provider_connections WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows;
}

function toConnection(row: ConnectionRow | undefined): ProviderConnection | null {
  if (!row || row.disconnected_at) return null;
  return {
    method: row.method,
    detail: row.detail,
    summary: row.summary,
    lastTest:
      row.last_test_at && row.last_test_ok !== null && row.last_test_message
        ? {
            ok: row.last_test_ok,
            message: row.last_test_message,
            testedAt: row.last_test_at.toISOString(),
          }
        : null,
    models: row.models,
    model: row.model,
    permission: row.permission,
    level: row.level,
    effort: row.effort,
    verifiedAt: row.verified_at.toISOString(),
  };
}

function connectedIds(rows: ConnectionRow[]): ProviderId[] {
  return rows.filter((row) => !row.disconnected_at).map((row) => row.provider);
}

export async function getSetupState(db: Queryable, workspaceId: string): Promise<SetupState> {
  const [profile, rows, advisors] = await Promise.all([
    ensureProfile(db, workspaceId),
    connectionRows(db, workspaceId),
    listAdvisors(db, workspaceId),
  ]);
  const connected = connectedIds(rows);
  const defaultProvider =
    profile.default_provider && connected.includes(profile.default_provider)
      ? profile.default_provider
      : (connected[0] ?? null);
  const providers: ProviderSetup[] = catalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    maker: entry.maker,
    cli: entry.cli,
    keyPrefix: entry.keyPrefix,
    keyHint: entry.keyHint,
    keyLink: entry.keyLink,
    note: entry.note,
    methods: entry.methods,
    permissions: entry.permissions,
    efforts: entry.efforts,
    defaultEffort: entry.defaultEffort,
    connection: toConnection(rows.find((row) => row.provider === entry.id)),
  }));
  const result: Profile = {
    displayName: profile.display_name,
    defaultProvider,
    onboardingCompleted: profile.onboarding_completed_at !== null && connected.length > 0,
    autoContinueSeconds: profile.auto_continue_seconds,
    jevDiffs: profile.jev_diffs,
  };
  return { profile: result, providers, advisors };
}

export async function updateProfile(
  db: Queryable,
  workspaceId: string,
  update: UpdateProfileRequest,
): Promise<void> {
  await ensureProfile(db, workspaceId);
  if (update.defaultProvider) {
    const connected = connectedIds(await connectionRows(db, workspaceId));
    if (!connected.includes(update.defaultProvider)) {
      throw new InvalidDefaultError('Connect this provider before making it the default.');
    }
  }
  if (update.onboardingCompleted) {
    const connected = connectedIds(await connectionRows(db, workspaceId));
    if (connected.length === 0)
      throw new InvalidDefaultError('Connect a provider before finishing setup.');
  }
  await db.query(
    `UPDATE profiles SET
       display_name = COALESCE($2, display_name),
       default_provider = COALESCE($3, default_provider),
       onboarding_completed_at = CASE WHEN $4 THEN COALESCE(onboarding_completed_at, now()) ELSE onboarding_completed_at END,
       auto_continue_seconds = CASE WHEN $5 THEN $6::integer ELSE auto_continue_seconds END,
       jev_diffs = COALESCE($7, jev_diffs),
       updated_at = now()
     WHERE workspace_id = $1`,
    [
      workspaceId,
      update.displayName?.trim() ?? null,
      update.defaultProvider ?? null,
      update.onboardingCompleted ?? false,
      update.autoContinueSeconds !== undefined,
      update.autoContinueSeconds ?? null,
      update.jevDiffs ?? null,
    ],
  );
}

export async function autoContinueSeconds(
  db: Queryable,
  workspaceId: string,
): Promise<number | null> {
  return (await ensureProfile(db, workspaceId)).auto_continue_seconds;
}

export async function saveConnection(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  verified: VerifiedConnection,
): Promise<ProviderConnection> {
  const entry = catalogEntry(provider);
  const defaultModel = effectiveDefaultModel(
    provider,
    verified.models,
    verified.models[0]?.id ?? null,
  );
  const { rows } = await db.query<ConnectionRow>(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, now(), $8)
     ON CONFLICT (workspace_id, provider) DO UPDATE SET
       method = EXCLUDED.method,
       detail = EXCLUDED.detail,
       summary = EXCLUDED.summary,
       last_test_at = NULL,
       last_test_ok = NULL,
       last_test_message = NULL,
       models = EXCLUDED.models,
       model = CASE
         WHEN provider_connections.model IS NOT NULL
           AND EXCLUDED.models @> jsonb_build_array(jsonb_build_object('id', provider_connections.model))
         THEN provider_connections.model
         ELSE EXCLUDED.model
       END,
       verified_at = now(),
       disconnected_at = NULL
     RETURNING *`,
    [
      workspaceId,
      provider,
      verified.method,
      verified.detail,
      JSON.stringify(verified.models),
      defaultModel,
      entry.permissions[0]!.id,
      verified.summary,
    ],
  );
  return toConnection(rows[0])!;
}

export async function activeConnection(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<ProviderConnection | null> {
  const row = (await connectionRows(db, workspaceId)).find(
    (candidate) => candidate.provider === provider,
  );
  return toConnection(row);
}

export async function recordTest(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  outcome: TestOutcome,
): Promise<void> {
  await db.query(
    `UPDATE provider_connections
     SET last_test_at = now(), last_test_ok = $3, last_test_message = $4
     WHERE workspace_id = $1 AND provider = $2 AND disconnected_at IS NULL`,
    [workspaceId, provider, outcome.ok, outcome.message],
  );
}

export async function disconnectProvider(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<void> {
  const connected = connectedIds(await connectionRows(db, workspaceId));
  if (!connected.includes(provider)) return;
  await db.query(
    `UPDATE provider_connections SET disconnected_at = now()
     WHERE workspace_id = $1 AND provider = $2`,
    [workspaceId, provider],
  );
}

async function capabilityOptions(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
): Promise<{ models: CapabilityOption[]; efforts: CapabilityOption[] } | null> {
  const { rows } = await db.query<{ models: CapabilityOption[]; efforts: CapabilityOption[] }>(
    'SELECT models, efforts FROM provider_capabilities WHERE workspace_id = $1 AND provider = $2',
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

export async function updateProviderDefaults(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  update: {
    model?: string | undefined;
    permission?: string | undefined;
    level?: InvolvementLevel | undefined;
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
  if (update.permission && !isSelectablePermission(entry, update.permission)) {
    const choice = entry.permissions.find((option) => option.id === update.permission);
    throw new InvalidDefaultError(
      choice?.unavailableReason ?? `${entry.name} does not have that permission mode.`,
    );
  }
  if (update.effort && !(await reportsEffort(db, workspaceId, provider, update.effort))) {
    throw new InvalidDefaultError(`${entry.name} does not have that effort level.`);
  }
  const { rows } = await db.query<ConnectionRow>(
    `UPDATE provider_connections SET
       model = COALESCE($3, model),
       permission = COALESCE($4, permission),
       effort = CASE WHEN $7 THEN $5 ELSE effort END,
       level = COALESCE($6, level)
     WHERE workspace_id = $1 AND provider = $2
     RETURNING *`,
    [
      workspaceId,
      provider,
      update.model ?? null,
      update.permission ?? null,
      update.effort ?? null,
      update.level ?? null,
      update.effort !== undefined,
    ],
  );
  return toConnection(rows[0])!;
}
