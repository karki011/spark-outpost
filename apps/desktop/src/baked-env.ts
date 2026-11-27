import { readBakedManifest } from './baked-manifest.ts';
import {
  cloudflareClientEnv,
  cloudflareClientFromManifest,
  readDevCloudflareClient,
} from './cloudflare-client.ts';
import { gitHubAppEnv, gitHubAppFromManifest } from './github-app.ts';
import { googleClientEnv, googleClientFromManifest, readDevGoogleClient } from './google-client.ts';
import {
  microsoftClientEnv,
  microsoftClientFromManifest,
  readDevMicrosoftClient,
} from './microsoft-client.ts';
import { shareEnvFromManifest } from './share-url.ts';
import { readDevZoomClient, zoomClientEnv, zoomClientFromManifest } from './zoom-client.ts';
import {
  readDevSlackClientId,
  SLACK_CLIENT_ID_ENV,
  slackClientIdFromManifest,
} from './slack-sign-in.ts';

interface DevSignInFiles {
  googleClientFile: string | null;
  microsoftClientFile?: string | null;
  zoomClientFile?: string | null;
  cloudflareClientFile?: string | null;
  shareWorkerFile?: string | null;
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
  const zoom =
    zoomClientFromManifest(manifest) ?? (await readDevZoomClient(devFiles.zoomClientFile ?? null));
  const cloudflare =
    cloudflareClientFromManifest(manifest) ??
    (await readDevCloudflareClient(devFiles.cloudflareClientFile ?? null));
  return {
    ...gitHubAppEnv(gitHubAppFromManifest(manifest)),
    ...(slack ? { [SLACK_CLIENT_ID_ENV]: slack } : {}),
    ...googleClientEnv(google),
    ...microsoftClientEnv(microsoft),
    ...zoomClientEnv(zoom),
    ...(await cloudflareClientEnv(cloudflare, devFiles.shareWorkerFile ?? null)),
    ...shareEnvFromManifest(manifest),
  };
}
