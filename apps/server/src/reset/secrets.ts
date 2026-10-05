import { connectableIdSchema, ticketSourceIdSchema } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { SLACK_SECRET_IDS, SLACK_SIGN_IN_SECRET, type SecretId } from '../setup/secrets.ts';

export async function storedSecretIds(db: Queryable, keepApiKeys: boolean): Promise<SecretId[]> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM mcp_servers ORDER BY id');
  return [
    ...(keepApiKeys ? [] : connectableIdSchema.options),
    'github',
    'github-app',
    ...ticketSourceIdSchema.options.map((source) => `ticket:${source}` as const),
    ...SLACK_SECRET_IDS,
    SLACK_SIGN_IN_SECRET,
    ...rows.map((row) => `mcp:${row.id}` as const),
  ];
}
