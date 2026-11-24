import type { Db } from '../persistence/db.ts';
import type { SecretStore } from '../setup/secrets.ts';
import { googleClientConfig } from './google/config.ts';
import { createGoogleSource, type GoogleSource } from './google/source.ts';
import { microsoftClientConfig } from './microsoft/config.ts';
import { createMicrosoftSource, type MicrosoftSource } from './microsoft/source.ts';

type CloudEnv = Parameters<typeof googleClientConfig>[0] &
  Parameters<typeof microsoftClientConfig>[0];

export interface CloudCalendars {
  google: GoogleSource | null;
  microsoft: MicrosoftSource | null;
}

export async function startCloudCalendars(
  env: CloudEnv,
  deps: { db: Db; workspaceId: string; secrets: SecretStore; fetch: typeof fetch },
): Promise<CloudCalendars> {
  const google = createGoogleSource({ ...deps, client: googleClientConfig(env) });
  const microsoft = createMicrosoftSource({ ...deps, client: microsoftClientConfig(env) });
  await Promise.all([google.start(), microsoft.start()]);
  return { google, microsoft };
}
