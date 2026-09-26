import type {
  AdvisorConnection,
  AdvisorId,
  AdvisorSetup,
  ProviderModel,
} from '@spark-outpost/contracts';
import { advisorCatalog, advisorEntry } from '../providers/catalog.ts';
import type { VerifiedConnection } from '../setup/verify.ts';
import type { Queryable } from './db.ts';

interface AdvisorRow {
  advisor: AdvisorId;
  method: 'api_key';
  detail: string;
  summary: string | null;
  models: ProviderModel[];
  model: string | null;
  verified_at: Date;
  disconnected_at: Date | null;
}

function toConnection(row: AdvisorRow | undefined): AdvisorConnection | null {
  if (!row || row.disconnected_at) return null;
  return {
    method: row.method,
    detail: row.detail,
    summary: row.summary,
    models: row.models,
    model: row.model,
    verifiedAt: row.verified_at.toISOString(),
  };
}

async function advisorRows(db: Queryable, workspaceId: string): Promise<AdvisorRow[]> {
  const { rows } = await db.query<AdvisorRow>(
    'SELECT * FROM advisor_connections WHERE workspace_id = $1',
    [workspaceId],
  );
  return rows;
}

export async function listAdvisors(db: Queryable, workspaceId: string): Promise<AdvisorSetup[]> {
  const rows = await advisorRows(db, workspaceId);
  return advisorCatalog.map((entry) => ({
    id: entry.id,
    name: entry.name,
    maker: entry.maker,
    cli: '',
    keyPrefix: entry.keyPrefix,
    keyHint: entry.keyHint,
    methods: ['api_key'],
    role: entry.role,
    connection: toConnection(rows.find((row) => row.advisor === entry.id)),
  }));
}

export async function saveAdvisorConnection(
  db: Queryable,
  workspaceId: string,
  advisor: AdvisorId,
  verified: VerifiedConnection,
): Promise<AdvisorConnection> {
  const { defaultModel } = advisorEntry(advisor);
  const model = verified.models.some((option) => option.id === defaultModel)
    ? defaultModel
    : (verified.models[0]?.id ?? null);
  const { rows } = await db.query<AdvisorRow>(
    `INSERT INTO advisor_connections
       (workspace_id, advisor, method, detail, summary, models, model, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (workspace_id, advisor) DO UPDATE SET
       method = EXCLUDED.method,
       detail = EXCLUDED.detail,
       summary = EXCLUDED.summary,
       models = EXCLUDED.models,
       model = EXCLUDED.model,
       verified_at = now(),
       disconnected_at = NULL
     RETURNING *`,
    [
      workspaceId,
      advisor,
      verified.method,
      verified.detail,
      verified.summary,
      JSON.stringify(verified.models),
      model,
    ],
  );
  return toConnection(rows[0])!;
}

export async function disconnectAdvisor(
  db: Queryable,
  workspaceId: string,
  advisor: AdvisorId,
): Promise<void> {
  await db.query(
    `UPDATE advisor_connections SET disconnected_at = now()
     WHERE workspace_id = $1 AND advisor = $2 AND disconnected_at IS NULL`,
    [workspaceId, advisor],
  );
}
