import { connectableIdSchema, ticketSourceIdSchema } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { signInRefs } from '../persistence/browser-sign-ins.ts';
import { googleSubjects } from '../calendar/google/store.ts';
import {
  SLACK_SECRET_IDS,
  SLACK_SIGN_IN_SECRET,
  googleCalendarSecret,
  type SecretId,
} from '../setup/secrets.ts';

export async function storedSecretIds(db: Queryable, keepApiKeys: boolean): Promise<SecretId[]> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM mcp_servers ORDER BY id');
  const signIns = (await signInRefs(db)).filter((ref): ref is `signin:${string}` =>
    ref.startsWith('signin:'),
  );
  return [
    ...(keepApiKeys ? [] : connectableIdSchema.options),
    'github',
    'github-app',
    ...ticketSourceIdSchema.options.map((source) => `ticket:${source}` as const),
    ...SLACK_SECRET_IDS,
    SLACK_SIGN_IN_SECRET,
    ...rows.map((row) => `mcp:${row.id}` as const),
    ...signIns,
    ...(await googleSubjects(db)).map(googleCalendarSecret),
  ];
}
