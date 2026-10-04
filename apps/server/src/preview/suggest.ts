import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  localPreviewUrl,
  previewConfigSchema,
  type PreviewConfig,
  type PreviewSuggestion,
} from '@spark-outpost/contracts';

const FILE_MAX_BYTES = 256 * 1024;
const SUGGESTIONS_MAX = 6;

const launchSchema = z.object({
  configurations: z
    .array(
      z.object({
        name: z.string().max(200).optional(),
        runtimeExecutable: z.string().min(1).max(200),
        runtimeArgs: z.array(z.string().max(300)).max(40).default([]),
        port: z.number().int().min(1).max(65_535).optional(),
        url: z.string().max(2048).optional(),
      }),
    )
    .max(20),
});

const packageSchema = z.object({
  scripts: z.record(z.string(), z.string()).default({}),
  dependencies: z.record(z.string(), z.unknown()).default({}),
  devDependencies: z.record(z.string(), z.unknown()).default({}),
});

export type PackageRunner = 'pnpm' | 'yarn' | 'bun' | 'npm';

export interface SuggestionSources {
  launchJson: string | null;
  packageJson: string | null;
  runner: PackageRunner;
}

const SAFE_WORD = /^[\w@%+=:,./-]+$/;

function shellWord(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

function parsed<Schema extends z.ZodType>(schema: Schema, text: string | null) {
  if (text === null) return null;
  try {
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function suggestion(
  source: PreviewSuggestion['source'],
  label: string,
  config: Pick<PreviewConfig, 'command' | 'url'>,
): PreviewSuggestion | null {
  const checked = previewConfigSchema.safeParse(config);
  return checked.success ? { source, label: label.slice(0, 200), config: checked.data } : null;
}

function fromLaunch(text: string | null): (PreviewSuggestion | null)[] {
  const launch = parsed(launchSchema, text);
  if (!launch) return [];
  return launch.configurations.map((entry) => {
    const url =
      (entry.url ? localPreviewUrl(entry.url) : null) ??
      (entry.port ? `http://localhost:${entry.port}` : null);
    if (!url) return null;
    const command = [entry.runtimeExecutable, ...entry.runtimeArgs].map(shellWord).join(' ');
    const name = entry.name ? `${entry.name} · ` : '';
    return suggestion('launch.json', `${name}.claude/launch.json`, { command, url });
  });
}

const DEV_SCRIPTS = ['dev', 'start', 'serve', 'develop'];

const FRAMEWORK_PORTS: readonly (readonly [RegExp, number])[] = [
  [/\bnext\b/, 3000],
  [/\bnuxt\b/, 3000],
  [/\bastro\b/, 4321],
  [/\bng serve\b|@angular\/cli/, 4200],
  [/\bgatsby\b/, 8000],
  [/\bvue-cli-service\b|@vue\/cli-service|webpack-dev-server|\bwebpack serve\b/, 8080],
  [/\bparcel\b/, 1234],
  [/\breact-scripts\b/, 3000],
  [/\bvite\b|@sveltejs\/kit|@remix-run\/dev/, 5173],
];

const STATED_PORT = /(?:--port[= ]|-p |\bPORT=)(\d{2,5})\b/;

export function likelyPort(script: string, dependencies: readonly string[]): number {
  const stated = STATED_PORT.exec(script);
  if (stated) return Number(stated[1]);
  const fromScript = FRAMEWORK_PORTS.find(([pattern]) => pattern.test(script));
  if (fromScript) return fromScript[1];
  const names = dependencies.join(' ');
  return FRAMEWORK_PORTS.find(([pattern]) => pattern.test(names))?.[1] ?? 3000;
}

function runCommand(runner: PackageRunner, script: string): string {
  if (runner === 'npm') return script === 'start' ? 'npm start' : `npm run ${script}`;
  if (runner === 'bun') return `bun run ${script}`;
  return `${runner} ${script}`;
}

function fromPackage(text: string | null, runner: PackageRunner): (PreviewSuggestion | null)[] {
  const manifest = parsed(packageSchema, text);
  if (!manifest) return [];
  const dependencies = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies),
  ];
  return DEV_SCRIPTS.filter((name) => manifest.scripts[name] !== undefined).map((name) => {
    const port = likelyPort(manifest.scripts[name]!, dependencies);
    return suggestion('package.json', `${name} script · package.json`, {
      command: runCommand(runner, name),
      url: `http://localhost:${port}`,
    });
  });
}

export function suggestPreviews(sources: SuggestionSources): PreviewSuggestion[] {
  const found = [
    ...fromLaunch(sources.launchJson),
    ...fromPackage(sources.packageJson, sources.runner),
  ];
  return found.filter((entry) => entry !== null).slice(0, SUGGESTIONS_MAX);
}

async function smallFile(file: string): Promise<string | null> {
  try {
    const data = await readFile(file);
    return data.length > FILE_MAX_BYTES ? null : data.toString('utf8');
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

const LOCKFILES: readonly (readonly [string, PackageRunner])[] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];

async function runnerOf(root: string): Promise<PackageRunner> {
  for (const [lockfile, runner] of LOCKFILES) {
    if (await exists(path.join(root, lockfile))) return runner;
  }
  return 'npm';
}

export async function readPreviewSuggestions(root: string): Promise<PreviewSuggestion[]> {
  const [launchJson, packageJson, runner] = await Promise.all([
    smallFile(path.join(root, '.claude', 'launch.json')),
    smallFile(path.join(root, 'package.json')),
    runnerOf(root),
  ]);
  return suggestPreviews({ launchJson, packageJson, runner });
}
