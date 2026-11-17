import { SHARE_URL_ENV, shareServiceOrigin } from '@spark-outpost/contracts';
import { readBakedManifest, type BakedManifest } from './baked-manifest.ts';

export function shareEnvFromManifest(manifest: BakedManifest | null): Record<string, string> {
  const shareUrl = manifest?.shareUrl;
  const origin = typeof shareUrl === 'string' ? shareServiceOrigin(shareUrl) : null;
  return origin ? { [SHARE_URL_ENV]: origin } : {};
}

export async function bakedShareEnv(appPath: string): Promise<Record<string, string>> {
  return shareEnvFromManifest(await readBakedManifest(appPath));
}
