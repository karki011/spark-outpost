import { readBakedManifest } from './baked-manifest.ts';
import { gitHubAppEnv, gitHubAppFromManifest } from './github-app.ts';
import { googleClientEnv, googleClientFromManifest, readDevGoogleClient } from './google-client.ts';
import {
  microsoftClientEnv,
  microsoftClientFromManifest,
  readDevMicrosoftClient,
} from './microsoft-client.ts';
import { shareEnvFromManifest } from './share-url.ts';
import {
  readDevSlackClientId,
  SLACK_CLIENT_ID_ENV,
  slackClientIdFromManifest,
} from './slack-sign-in.ts';

interface DevSignInFiles {
  googleClientFile: string | null;
  microsoftClientFile?: string | null;
  slackClientIdFile: string | null;
}

export async function bakedServerEnv(
  appPath: string,
  devFiles: DevSignInFiles = { googleClientFile: null, slackClientIdFile: null },
): Promise<Record<string, string>> {
  const manifest = await readBakedManifest(appPath);
  const slack =
    slackClientIdFromManifest(manifest) ?? (await readDevSlackClientId(devFiles.slackClientIdFile));
  const google =
    googleClientFromManifest(manifest) ?? (await readDevGoogleClient(devFiles.googleClientFile));
  const microsoft =
    microsoftClientFromManifest(manifest) ??
    (await readDevMicrosoftClient(devFiles.microsoftClientFile ?? null));
  return {
    ...gitHubAppEnv(gitHubAppFromManifest(manifest)),
    ...(slack ? { [SLACK_CLIENT_ID_ENV]: slack } : {}),
    ...googleClientEnv(google),
    ...microsoftClientEnv(microsoft),
    ...shareEnvFromManifest(manifest),
  };
}
