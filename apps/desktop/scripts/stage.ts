import { execFile } from 'node:child_process';
import { cp, glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { build, Platform } from 'electron-builder';
import { builderConfig, type MacArch } from './builder-config.ts';

const run = promisify(execFile);

export const desktopDir = path.resolve(import.meta.dirname, '..');
export const repoRoot = path.resolve(desktopDir, '../..');
export const releaseDir = path.join(desktopDir, 'release');

const DEPLOY_LEFTOVERS = [
  'node_modules/.pnpm',
  'node_modules/.bin',
  'node_modules/.modules.yaml',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
];

async function deploy(
  filter: string,
  arch: MacArch,
  target: string,
  unused: string[],
): Promise<void> {
  await run(
    'pnpm',
    [
      '--filter',
      filter,
      'deploy',
      '--prod',
      `--cpu=${arch}`,
      '--os=darwin',
      '--config.node-linker=hoisted',
      target,
    ],
    { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  for (const leftover of [...DEPLOY_LEFTOVERS, ...unused]) {
    await rm(path.join(target, leftover), { recursive: true, force: true });
  }
}

async function stageArch(stageDir: string, arch: MacArch): Promise<void> {
  const archDir = path.join(stageDir, arch);
  await deploy('@spark-outpost/desktop', arch, path.join(archDir, 'runtime'), [
    'src',
    'scripts',
    'build',
  ]);
  const serverDir = path.join(archDir, 'server');
  await deploy('@spark-outpost/server', arch, serverDir, ['test']);
  for await (const test of glob('src/**/*.test.ts', { cwd: serverDir })) {
    await rm(path.join(serverDir, test));
  }
}

async function stageApp(stageDir: string, version: string): Promise<void> {
  const appDir = path.join(stageDir, 'app');
  await mkdir(appDir, { recursive: true });
  await cp(path.join(desktopDir, 'dist'), path.join(appDir, 'dist'), { recursive: true });
  await cp(path.join(desktopDir, 'assets'), path.join(appDir, 'assets'), { recursive: true });
  const manifest = {
    name: 'spark-outpost',
    productName: 'Spark Outpost',
    version,
    private: true,
    type: 'module',
    main: 'dist/main.js',
  };
  await writeFile(path.join(appDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(path.join(repoRoot, 'apps/web/dist'), path.join(stageDir, 'web'), { recursive: true });
}

async function electronVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(desktopDir, 'package.json'), 'utf8')) as {
    devDependencies: Record<string, string>;
  };
  const version = manifest.devDependencies.electron;
  if (!version) throw new Error('apps/desktop has no pinned electron version.');
  return version;
}

export interface PackageOptions {
  version: string;
  archs: MacArch[];
  outputDir: string;
  env: Record<string, string | undefined>;
  packageName?: string;
  appId?: string;
  formats?: ('zip' | 'dmg')[];
  prepareServer?: (serverDir: string) => Promise<void>;
}

export async function packageDesktop(options: PackageOptions): Promise<string[]> {
  const stageDir = path.join(releaseDir, 'stage');
  await rm(stageDir, { recursive: true, force: true });
  await stageApp(stageDir, options.version);
  for (const arch of options.archs) {
    await stageArch(stageDir, arch);
    await options.prepareServer?.(path.join(stageDir, arch, 'server'));
  }
  const config = builderConfig({
    stageDir,
    outputDir: options.outputDir,
    version: options.version,
    electronVersion: await electronVersion(),
    archs: options.archs,
    env: options.env,
    entitlements: path.join(desktopDir, 'build/entitlements.mac.plist'),
    icon: path.join(desktopDir, 'build/icon.icns'),
    ...(options.packageName ? { packageName: options.packageName } : {}),
    ...(options.formats ? { formats: options.formats } : {}),
    ...(options.appId ? { appId: options.appId } : {}),
  });
  const artifacts = await build({
    projectDir: path.join(stageDir, 'app'),
    targets: Platform.MAC.createTarget(),
    config,
    publish: 'never',
  });
  await writeReleaseNotes(options.outputDir, options.version);
  return artifacts;
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function writeReleaseNotes(outputDir: string, version: string): Promise<void> {
  const changelog = await readFile(path.join(desktopDir, 'CHANGELOG.md'), 'utf8');
  const page = [
    '<!doctype html>',
    '<html lang="en">',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Spark Outpost ${escapeHtml(version)} release notes</title>`,
    '<body style="font: 15px/1.5 system-ui, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px">',
    `<pre style="white-space: pre-wrap; font: inherit">${escapeHtml(changelog)}</pre>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  await writeFile(path.join(outputDir, 'release-notes.html'), page);
}
