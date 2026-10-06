import { cp } from 'node:fs/promises';
import path from 'node:path';
import { Arch, type AfterPackContext, type Configuration } from 'electron-builder';
import { channelConfig } from '../src/channel.ts';
import {
  GITHUB_APP_CLIENT_ID_ENV,
  GITHUB_APP_SLUG_ENV,
  gitHubAppIds,
  type GitHubAppIds,
} from '../src/github-app.ts';
import { HEARTBEAT_URL_ENV, heartbeatUrl } from '../src/heartbeat.ts';
import { SLACK_CLIENT_ID_ENV, slackClientId } from '../src/slack-sign-in.ts';

export const UPDATE_FEED_ENV = 'SPARK_UPDATE_FEED_URL';
const UPDATE_FEED_URL = '';
const HEARTBEAT_URL = '';
const GITHUB_APP_CLIENT_ID = 'Iv23li7XhI8fUF6WSltL';
const GITHUB_APP_SLUG = 'spark-outpost';
const SLACK_CLIENT_ID = '';

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

export function packagedGitHubApp(env: Env): GitHubAppIds | null {
  const clientId = (env[GITHUB_APP_CLIENT_ID_ENV] ?? GITHUB_APP_CLIENT_ID).trim();
  if (clientId === '') return null;
  const slug = (env[GITHUB_APP_SLUG_ENV] ?? GITHUB_APP_SLUG).trim();
  const ids = gitHubAppIds(clientId, slug);
  if (!ids || ids.slug !== slug) {
    throw new Error(
      `${GITHUB_APP_CLIENT_ID_ENV} must be the GitHub App's client ID (letters, digits and dots) and ${GITHUB_APP_SLUG_ENV} its URL name (letters, digits and dashes). Never a client secret or private key.`,
    );
  }
  return ids;
}

export function packagedSlackClientId(env: Env): string | null {
  const wanted = (env[SLACK_CLIENT_ID_ENV] ?? SLACK_CLIENT_ID).trim();
  if (wanted === '') return null;
  const clientId = slackClientId(wanted);
  if (!clientId) {
    throw new Error(
      `${SLACK_CLIENT_ID_ENV} must be the Slack app's client ID (digits, a dot, digits). Never a client secret, signing secret or token.`,
    );
  }
  return clientId;
}

export const RELEASE_ARCHS: MacArch[] = ['x64', 'arm64'];

export function releaseProblems(env: Env, archs: MacArch[]): string[] {
  const problems: string[] = [];
  if (!env.CSC_NAME && !env.CSC_LINK) {
    problems.push(
      'CSC_NAME is not set. A release must be signed with your Developer ID Application certificate: install it in the login keychain, then set CSC_NAME="Developer ID Application: <Name> (<TEAMID>)". For an unsigned local build, leave out --release.',
    );
  }
  if (!hasNotaryCredentials(env)) {
    problems.push(
      'Notarization credentials are missing. Set APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID (or APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER).',
    );
  }
  if (!updateFeedUrl(env)) {
    problems.push(
      `No update feed. Set ${UPDATE_FEED_ENV} (or UPDATE_FEED_URL in apps/desktop/scripts/builder-config.ts) so the build writes the channel files and can update itself.`,
    );
  }
  if (!RELEASE_ARCHS.every((arch) => archs.includes(arch))) {
    problems.push(
      'A release builds Apple silicon and Intel together so one channel file lists both. Leave out --arch.',
    );
  }
  return problems;
}

export function updateFeedUrl(env: Env): string | null {
  const url = (env[UPDATE_FEED_ENV] ?? UPDATE_FEED_URL).trim().replace(/\/+$/, '');
  return url === '' ? null : url;
}

export function packagedHeartbeatUrl(env: Env): string | null {
  const value = (env[HEARTBEAT_URL_ENV] ?? HEARTBEAT_URL).trim();
  if (value === '') return null;
  const url = heartbeatUrl(value);
  if (!url) {
    throw new Error(
      `${HEARTBEAT_URL_ENV} must be an https address such as https://spark-outpost-heartbeat.<subdomain>.workers.dev/v1/heartbeat.`,
    );
  }
  return url;
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
  icon: string;
  packageName?: string;
  appId?: string;
  formats?: ('zip' | 'dmg')[];
}

export function builderConfig(options: BuilderOptions): Configuration {
  const prod = channelConfig('prod');
  const signing = signingPlan(options.env);
  const feed = updateFeedUrl(options.env);
  const heartbeat = packagedHeartbeatUrl(options.env);
  const githubApp = packagedGitHubApp(options.env);
  const slackApp = packagedSlackClientId(options.env);
  return {
    appId: options.appId ?? prod.appId,
    productName: prod.appName,
    electronVersion: options.electronVersion,
    extraMetadata: {
      version: options.version,
      name: options.packageName ?? 'spark-outpost',
      ...(heartbeat ? { heartbeatUrl: heartbeat } : {}),
      ...(githubApp ? { githubApp } : {}),
      ...(slackApp ? { slackApp: { clientId: slackApp } } : {}),
    },
    directories: { output: options.outputDir },
    npmRebuild: false,
    asar: false,
    files: ['package.json', 'dist/**', 'assets/**'],
    afterPack: (context) =>
      copyRuntime(options.stageDir, Arch[context.arch] as MacArch, resourcesDir(context)),
    protocols: [{ name: prod.appName, schemes: [prod.linkScheme] }],
    artifactName: 'Spark-Outpost-${version}-${arch}.${ext}',
    generateUpdatesFilesForAllChannels: true,
    publish: feed ? [{ provider: 'generic', url: feed, useMultipleRangeRequest: false }] : null,
    mac: {
      category: 'public.app-category.developer-tools',
      icon: options.icon,
      electronLanguages: ['en'],
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
    dmg: { writeUpdateInfo: false, sign: !signing.adHoc },
  };
}
