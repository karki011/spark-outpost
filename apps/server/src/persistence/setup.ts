import {
  compactionThresholdError,
  defaultModeFor,
  modePosture,
  permissionFor,
  type AgentModeOption,
  type CompactionThresholds,
  type InvolvementLevel,
  type Personality,
  type Profile,
  type ProviderConnection,
  type ProviderId,
  type ProviderModel,
  type ProviderSetup,
  type SetupState,
  type SparkSessionPrefs,
  type UpdateProfileRequest,
} from '@spark-outpost/contracts';
import { effectiveDefaultModel, retirementOf, usableDefault } from '../model-cards/cards.ts';
import { catalog, catalogEntry } from '../providers/catalog.ts';
import { INITIAL_PROVIDER_EFFORT } from '../providers/efforts.ts';
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
  ship_failing_checks: boolean;
  pr_ready_for_review: boolean;
  pr_follow_up: boolean;
  pr_follow_up_checks: boolean;
  pr_follow_up_reviews: boolean;
  pr_follow_up_replies: boolean;
  personality: Personality;
  spark_enabled: boolean;
  default_level: InvolvementLevel;
  spend_cap_usd: string | null;
  morning_brief: boolean;
  morning_brief_time: string;
  compact_warn_percent: number;
  compact_at_percent: number;
  auto_compact: boolean;
}

export interface ConnectionRow {
  provider: ProviderId;
  method: 'cli' | 'api_key';
  detail: string;
  models: ProviderModel[];
  model: string | null;
  permission: string;
  agent_mode: string | null;
  effort: string | null;
  verified_at: Date;
  disconnected_at: Date | null;
  summary: string | null;
  last_test_at: Date | null;
  last_test_ok: boolean | null;
  last_test_message: string | null;
}

export class InvalidDefaultError extends Error {}

export function assertModeOffered(
  provider: ProviderId,
  mode: string,
  modes: readonly AgentModeOption[],
): void {
  const offered =
    modes.length > 0
      ? modes.some((option) => option.id === mode)
      : modePosture(provider, mode) !== 'unknown';
  if (!offered)
    throw new InvalidDefaultError(`${catalogEntry(provider).name} doesn't offer that mode.`);
}

async function ensureProfile(db: Queryable, workspaceId: string): Promise<ProfileRow> {
  await db.query('INSERT INTO profiles (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [
    workspaceId,
  ]);
  const { rows } = await db.query<ProfileRow>(
    `SELECT display_name, default_provider, onboarding_completed_at, auto_continue_seconds,
       jev_diffs, ship_failing_checks, pr_ready_for_review, pr_follow_up, pr_follow_up_checks,
       pr_follow_up_reviews, pr_follow_up_replies, personality, spark_enabled, default_level,
       spend_cap_usd, morning_brief, compact_warn_percent, compact_at_percent, auto_compact,
       to_char(morning_brief_time, 'HH24:MI') AS morning_brief_time
     FROM profiles WHERE workspace_id = $1`,
    [workspaceId],
  );
  return rows[0]!;
}

export async function connectionRows(db: Queryable, workspaceId: string): Promise<ConnectionRow[]> {
  const { rows } = await db.query<ConnectionRow>(
    'SELECT * FROM provider_connections WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows;
}

export function toConnection(row: ConnectionRow | undefined): ProviderConnection | null {
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
    model: usableDefault(row.provider, row.model),
    permission: row.permission,
    agentMode: row.agent_mode ?? defaultModeFor(row.provider),
    effort: row.effort,
    verifiedAt: row.verified_at.toISOString(),
  };
}

function connectedIds(rows: ConnectionRow[]): ProviderId[] {
  return rows.filter((row) => !row.disconnected_at).map((row) => row.provider);
}

function savedSpendCap(profile: ProfileRow): number | null {
  return profile.spend_cap_usd === null ? null : Number(profile.spend_cap_usd);
}

export function effectiveSpendCap(saved: number | null, serverCap: number | null): number | null {
  if (saved === null) return serverCap;
  return saved > 0 ? saved : null;
}

export async function getSetupState(
  db: Queryable,
  workspaceId: string,
  serverSpendCapUsd: number | null = null,
): Promise<SetupState> {
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
    shipFailingChecks: profile.ship_failing_checks,
    prReadyForReview: profile.pr_ready_for_review,
    prFollowUp: profile.pr_follow_up,
    prFollowUpChecks: profile.pr_follow_up_checks,
    prFollowUpReviews: profile.pr_follow_up_reviews,
    prFollowUpReplies: profile.pr_follow_up_replies,
    personality: profile.personality,
    sparkEnabled: profile.spark_enabled,
    defaultLevel: profile.default_level,
    spendCapUsd: effectiveSpendCap(savedSpendCap(profile), serverSpendCapUsd),
    morningBrief: profile.morning_brief,
    morningBriefTime: profile.morning_brief_time,
    compactWarnPercent: profile.compact_warn_percent,
    compactAtPercent: profile.compact_at_percent,
    autoCompact: profile.auto_compact,
  };
  return { profile: result, providers, advisors };
}

function assertThresholds(profile: ProfileRow, update: UpdateProfileRequest): void {
  const error = compactionThresholdError(
    update.compactWarnPercent ?? profile.compact_warn_percent,
    update.compactAtPercent ?? profile.compact_at_percent,
  );
  if (error) throw new InvalidDefaultError(error);
}

export async function updateProfile(
  db: Queryable,
  workspaceId: string,
  update: UpdateProfileRequest,
): Promise<void> {
  assertThresholds(await ensureProfile(db, workspaceId), update);
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
       ship_failing_checks = COALESCE($8, ship_failing_checks),
       personality = COALESCE($9, personality),
       spark_enabled = COALESCE($10, spark_enabled),
       default_level = COALESCE($11, default_level),
       spend_cap_usd = CASE WHEN $12 THEN COALESCE($13::numeric, 0) ELSE spend_cap_usd END,
       morning_brief = COALESCE($14, morning_brief),
       morning_brief_time = COALESCE($15::time, morning_brief_time),
       pr_ready_for_review = COALESCE($16, pr_ready_for_review),
       pr_follow_up = COALESCE($17, pr_follow_up),
       pr_follow_up_checks = COALESCE($18, pr_follow_up_checks),
       pr_follow_up_reviews = COALESCE($19, pr_follow_up_reviews),
       pr_follow_up_replies = COALESCE($20, pr_follow_up_replies),
       compact_warn_percent = COALESCE($21, compact_warn_percent),
       compact_at_percent = COALESCE($22, compact_at_percent),
       auto_compact = COALESCE($23, auto_compact),
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
      update.shipFailingChecks ?? null,
      update.personality ?? null,
      update.sparkEnabled ?? null,
      update.defaultLevel ?? null,
      update.spendCapUsd !== undefined,
      update.spendCapUsd ?? null,
      update.morningBrief ?? null,
      update.morningBriefTime ?? null,
      update.prReadyForReview ?? null,
      update.prFollowUp ?? null,
      update.prFollowUpChecks ?? null,
      update.prFollowUpReviews ?? null,
      update.prFollowUpReplies ?? null,
      update.compactWarnPercent ?? null,
      update.compactAtPercent ?? null,
      update.autoCompact ?? null,
    ],
  );
}

export async function shipsFailingChecks(db: Queryable, workspaceId: string): Promise<boolean> {
  return (await ensureProfile(db, workspaceId)).ship_failing_checks;
}

export interface SparkPreferences extends SparkSessionPrefs {
  sparkEnabled: boolean;
  savedSpendCapUsd: number | null;
}

export async function sparkPreferences(
  db: Queryable,
  workspaceId: string,
): Promise<SparkPreferences> {
  const profile = await ensureProfile(db, workspaceId);
  return {
    displayName: profile.display_name,
    personality: profile.personality,
    sparkEnabled: profile.spark_enabled,
    savedSpendCapUsd: savedSpendCap(profile),
  };
}

export interface MorningBriefSetting {
  enabled: boolean;
  time: string;
}

export async function morningBriefSetting(
  db: Queryable,
  workspaceId: string,
): Promise<MorningBriefSetting> {
  const profile = await ensureProfile(db, workspaceId);
  return { enabled: profile.morning_brief, time: profile.morning_brief_time };
}

export async function autoContinueSeconds(
  db: Queryable,
  workspaceId: string,
): Promise<number | null> {
  return (await ensureProfile(db, workspaceId)).auto_continue_seconds;
}

export async function compactionThresholds(
  db: Queryable,
  workspaceId: string,
): Promise<CompactionThresholds> {
  const profile = await ensureProfile(db, workspaceId);
  return {
    warnPercent: profile.compact_warn_percent,
    compactPercent: profile.compact_at_percent,
    autoCompact: profile.auto_compact,
  };
}

export async function saveConnection(
  db: Queryable,
  workspaceId: string,
  provider: ProviderId,
  verified: VerifiedConnection,
): Promise<ProviderConnection> {
  const defaultMode = defaultModeFor(provider);
  const defaultModel = effectiveDefaultModel(
    provider,
    verified.models,
    verified.models[0]?.id ?? null,
  );
  const { rows } = await db.query<ConnectionRow>(
    `INSERT INTO provider_connections
       (workspace_id, provider, method, detail, models, model, permission, effort, verified_at,
        summary, agent_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
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
           AND NOT provider_connections.model = ANY($11::text[])
         THEN provider_connections.model
         ELSE EXCLUDED.model
       END,
       agent_mode = COALESCE(provider_connections.agent_mode, EXCLUDED.agent_mode),
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
      permissionFor(provider, defaultMode),
      INITIAL_PROVIDER_EFFORT,
      verified.summary,
      defaultMode,
      verified.models.flatMap((model) => (retirementOf(model, provider) ? [model.id] : [])),
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
