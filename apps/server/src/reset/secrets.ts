import { connectableIdSchema, ticketSourceIdSchema } from '@spark-outpost/contracts';
import type { Queryable } from '../persistence/db.ts';
import { signInRefs } from '../persistence/browser-sign-ins.ts';
import { cloudSubjects } from '../calendar/cloud/account-store.ts';
import { remoteSparkIds } from '../remote-sparks/store.ts';
import {
  CLOUDFLARE_TUNNEL_TOKEN_SECRET,
  CLOUDFLARE_UPLOAD_KEY_SECRET,
  SLACK_SECRET_IDS,
  SLACK_SIGN_IN_SECRET,
  googleCalendarSecret,
  microsoftCalendarSecret,
  remoteSparkAccessSecret,
  remoteSparkSecret,
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
    CLOUDFLARE_TUNNEL_TOKEN_SECRET,
    CLOUDFLARE_UPLOAD_KEY_SECRET,
    ...rows.map((row) => `mcp:${row.id}` as const),
    ...signIns,
    ...(await cloudSubjects(db, 'google')).map(googleCalendarSecret),
    ...(await cloudSubjects(db, 'microsoft')).map(microsoftCalendarSecret),
    ...(await remoteSparkIds(db)).flatMap((id) => [
      remoteSparkSecret(id),
      remoteSparkAccessSecret(id),
    ]),
  ];
}
