import { cp } from 'node:fs/promises';
import path from 'node:path';
import { Arch, type AfterPackContext, type Configuration } from 'electron-builder';
import { channelConfig } from '../src/channel.ts';

export const UPDATE_FEED_ENV = 'SPARK_UPDATE_FEED_URL';
const UPDATE_FEED_URL = '';

export type MacArch = 'x64' | 'arm64';

export interface SigningPlan {
  adHoc: boolean;
  notarize: boolean;
}

type Env = Record<string, string | undefined>;

function present(env: Env, names: string[]): boolean {
  return names.every((name) => Boolean(env[name]));
}

export function hasNotaryCredentials(env: Env): boolean {
  return (
    present(env, ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']) ||
    present(env, ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) ||
    present(env, ['APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE'])
  );
}

export function signingPlan(env: Env): SigningPlan {
  const developerId = Boolean(env.CSC_LINK || env.CSC_NAME);
  if (!developerId) return { adHoc: true, notarize: false };
  return { adHoc: false, notarize: hasNotaryCredentials(env) };
}

export function updateFeedUrl(env: Env): string | null {
  const url = (env[UPDATE_FEED_ENV] ?? UPDATE_FEED_URL).trim().replace(/\/+$/, '');
  return url === '' ? null : url;
}

function resourcesDir(context: AfterPackContext): string {
  const app = `${context.packager.appInfo.productFilename}.app`;
  return path.join(context.appOutDir, app, 'Contents/Resources');
}

async function copyRuntime(stageDir: string, arch: MacArch, resources: string): Promise<void> {
  const copy = (from: string, to: string) =>
    cp(from, path.join(resources, to), { recursive: true, verbatimSymlinks: true });
  await copy(path.join(stageDir, arch, 'runtime/node_modules'), 'app/node_modules');
  await copy(path.join(stageDir, arch, 'server'), 'server');
  await copy(path.join(stageDir, 'web'), 'web');
}

export interface BuilderOptions {
  stageDir: string;
  outputDir: string;
  version: string;
  electronVersion: string;
  archs: MacArch[];
  env: Env;
  entitlements: string;
  packageName?: string;
  appId?: string;
  formats?: ('zip' | 'dmg')[];
}

export function builderConfig(options: BuilderOptions): Configuration {
  const prod = channelConfig('prod');
  const signing = signingPlan(options.env);
  const feed = updateFeedUrl(options.env);
  return {
    appId: options.appId ?? prod.appId,
    productName: prod.appName,
    electronVersion: options.electronVersion,
    extraMetadata: { version: options.version, name: options.packageName ?? 'spark-outpost' },
    directories: { output: options.outputDir },
    npmRebuild: false,
    asar: false,
    files: ['package.json', 'dist/**'],
    afterPack: (context) =>
      copyRuntime(options.stageDir, Arch[context.arch] as MacArch, resourcesDir(context)),
    artifactName: 'Spark-Outpost-${version}-${arch}.${ext}',
    generateUpdatesFilesForAllChannels: true,
    publish: feed ? [{ provider: 'generic', url: feed }] : null,
    mac: {
      category: 'public.app-category.developer-tools',
      target: (options.formats ?? ['zip', 'dmg']).map((target) => ({
        target,
        arch: options.archs,
      })),
      ...(signing.adHoc ? { identity: '-' } : {}),
      notarize: signing.notarize,
      hardenedRuntime: true,
      entitlements: options.entitlements,
      entitlementsInherit: options.entitlements,
      minimumSystemVersion: '12.0',
    },
    dmg: { writeUpdateInfo: false },
  };
}
