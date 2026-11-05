import { RELEASE_ARCHS } from './builder-config.ts';

export type ReleaseMode = 'publish' | 'beta-only' | 'promote';

export interface LocalFile {
  name: string;
  size: number;
}

export interface UploadStep {
  name: string;
  source: string;
  size: number;
  cacheControl: string;
}

export interface ReleasePlan {
  version: string;
  mode: ReleaseMode;
  uploads: UploadStep[];
  requiredOnFeed: string[];
  problems: string[];
}

export interface PlanInput {
  version: string;
  mode: ReleaseMode;
  files: LocalFile[];
  channelText: (name: string) => string | null;
}

export const CHANNEL_CACHE = 'no-cache, max-age=0';
export const ARTIFACT_CACHE = 'public, max-age=31536000, immutable';
const RELEASE_NOTES = 'release-notes.html';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function prereleaseTag(version: string): string | null {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`${version} is not a semver version like 0.1.0 or 0.1.0-beta.1.`);
  return match[4]?.split('.')[0] ?? null;
}

function artifactNames(version: string): string[] {
  return RELEASE_ARCHS.flatMap((arch) => {
    const base = `Spark-Outpost-${version}-${arch}`;
    return [`${base}.zip`, `${base}.zip.blockmap`, `${base}.dmg`];
  });
}

function latestDmgs(version: string): { source: string; name: string }[] {
  return RELEASE_ARCHS.map((arch) => ({
    source: `Spark-Outpost-${version}-${arch}.dmg`,
    name: `Spark-Outpost-latest-${arch}.dmg`,
  }));
}

export function updateZips(version: string): string[] {
  return RELEASE_ARCHS.map((arch) => `Spark-Outpost-${version}-${arch}.zip`);
}

export function channelFiles(version: string, mode: ReleaseMode): string[] {
  const tag = prereleaseTag(version);
  if (mode === 'promote') return ['latest-mac.yml'];
  if (tag !== null || mode === 'beta-only') return ['beta-mac.yml'];
  return ['beta-mac.yml', 'latest-mac.yml'];
}

function modeProblems(version: string, mode: ReleaseMode): string[] {
  const tag = prereleaseTag(version);
  if (tag !== null && tag !== 'beta') {
    return [
      `${version} is a "${tag}" prerelease. Only beta prereleases (0.1.0-beta.1) have a channel.`,
    ];
  }
  if (tag !== null && mode !== 'publish') {
    return [
      `${version} is a beta version, so it can only go to Beta. To promote it, rebuild the same commit as ${version.split('-')[0]} and publish that.`,
    ];
  }
  return [];
}

export function channelFileUrls(text: string): { version: string | null; urls: string[] } {
  const version = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(text)?.[1] ?? null;
  const urls = [...text.matchAll(/^\s*-\s*url:\s*['"]?([^'"\s]+)['"]?\s*$/gm)].map(
    (match) => match[1]!,
  );
  return { version, urls };
}

function channelProblems(name: string, text: string | null, version: string): string[] {
  if (text === null) {
    return [
      `${name} is missing. Build with SPARK_UPDATE_FEED_URL set (or --release) so electron-builder writes the channel files.`,
    ];
  }
  const parsed = channelFileUrls(text);
  const problems: string[] = [];
  if (parsed.version !== version) {
    problems.push(`${name} is for ${parsed.version ?? 'an unknown version'}, not ${version}.`);
  }
  const missing = updateZips(version).filter((zip) => !parsed.urls.includes(zip));
  if (missing.length > 0) {
    problems.push(
      `${name} doesn't list ${missing.join(' and ')}. Build both architectures in one run (leave out --arch) so Apple silicon and Intel Macs each find their zip.`,
    );
  }
  return problems;
}

export function releasePlan(input: PlanInput): ReleasePlan {
  const { version, mode, files } = input;
  const problems = modeProblems(version, mode);
  const sizes = new Map(files.map((file) => [file.name, file.size]));
  const uploads: UploadStep[] = [];
  const requiredOnFeed = mode === 'promote' ? updateZips(version) : [];
  if (mode !== 'promote') {
    for (const name of artifactNames(version)) {
      const size = sizes.get(name);
      if (size === undefined) problems.push(`${name} is missing from the release folder.`);
      else uploads.push({ name, source: name, size, cacheControl: ARTIFACT_CACHE });
    }
    const notes = sizes.get(RELEASE_NOTES);
    if (notes !== undefined) {
      uploads.push({
        name: RELEASE_NOTES,
        source: RELEASE_NOTES,
        size: notes,
        cacheControl: CHANNEL_CACHE,
      });
    }
    for (const alias of latestDmgs(version)) {
      const size = sizes.get(alias.source);
      if (size !== undefined) uploads.push({ ...alias, size, cacheControl: CHANNEL_CACHE });
    }
  }
  for (const name of channelFiles(version, mode)) {
    const text = input.channelText(name);
    problems.push(...channelProblems(name, text, version));
    if (text !== null) {
      uploads.push({
        name,
        source: name,
        size: Buffer.byteLength(text),
        cacheControl: CHANNEL_CACHE,
      });
    }
  }
  return { version, mode, uploads, requiredOnFeed, problems };
}

function megabytes(size: number): string {
  return `${(size / 1024 / 1024).toFixed(1)} MB`.padStart(10);
}

export function describePlan(plan: ReleasePlan, target: string): string {
  const total = plan.uploads.reduce((sum, step) => sum + step.size, 0);
  const lines = [
    `Release ${plan.version} (${plan.mode}) to ${target}`,
    ...plan.requiredOnFeed.map((name) => `  must already be on the feed: ${name}`),
    ...plan.uploads.map(
      (step, index) =>
        `  ${String(index + 1).padStart(2)}. ${megabytes(step.size)}  ${step.name}${step.source === step.name ? '' : ` (copy of ${step.source})`}`,
    ),
    `  total ${megabytes(total).trim()}; channel files go last.`,
  ];
  return lines.join('\n');
}

export interface Uploader {
  list(): Promise<string[]>;
  upload(step: UploadStep): Promise<void>;
}

export async function runRelease(
  plan: ReleasePlan,
  uploader: Uploader,
  log: (line: string) => void,
): Promise<void> {
  if (plan.problems.length > 0) throw new Error('The release plan has problems; nothing uploaded.');
  if (plan.requiredOnFeed.length > 0) {
    const present = new Set(await uploader.list());
    const missing = plan.requiredOnFeed.filter((name) => !present.has(name));
    if (missing.length > 0) {
      throw new Error(
        `Not on the feed yet: ${missing.join(', ')}. Publish ${plan.version} to Beta first.`,
      );
    }
  }
  for (const step of plan.uploads) {
    log(`Uploading ${step.name}…`);
    await uploader.upload(step);
  }
  log(`Published ${plan.version}.`);
}
