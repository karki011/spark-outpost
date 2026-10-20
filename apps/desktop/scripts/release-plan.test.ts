import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CACHE,
  CHANNEL_CACHE,
  describePlan,
  releasePlan,
  runRelease,
  type LocalFile,
  type ReleaseMode,
  type UploadStep,
} from './release-plan.ts';

const MB = 1024 * 1024;

function channel(version: string, archs = ['x64', 'arm64']): string {
  const files = archs
    .map(
      (arch) =>
        `  - url: Spark-Outpost-${version}-${arch}.zip\n    sha512: abc${arch}\n    size: ${530 * MB}`,
    )
    .join('\n');
  return `version: ${version}\nfiles:\n${files}\npath: Spark-Outpost-${version}-x64.zip\nsha512: abc\nreleaseDate: '2026-10-01T12:00:00.000Z'\n`;
}

function built(version: string): LocalFile[] {
  return [
    ...['x64', 'arm64'].flatMap((arch) => [
      { name: `Spark-Outpost-${version}-${arch}.zip`, size: 530 * MB },
      { name: `Spark-Outpost-${version}-${arch}.zip.blockmap`, size: MB / 2 },
      { name: `Spark-Outpost-${version}-${arch}.dmg`, size: 540 * MB },
    ]),
    { name: 'release-notes.html', size: 2048 },
    { name: 'builder-debug.yml', size: 100 },
    { name: 'mac-arm64', size: 0 },
  ];
}

function plan(version: string, mode: ReleaseMode = 'publish', texts?: Record<string, string>) {
  const channels = texts ?? {
    'beta-mac.yml': channel(version),
    'latest-mac.yml': channel(version),
  };
  return releasePlan({
    version,
    mode,
    files: built(version),
    channelText: (name) => channels[name] ?? null,
  });
}

const names = (steps: UploadStep[]) => steps.map((step) => step.name);

describe('releasePlan', () => {
  it('uploads a beta build and its Beta channel file last, never touching Stable', () => {
    const beta = plan('0.1.0-beta.1', 'publish', { 'beta-mac.yml': channel('0.1.0-beta.1') });
    expect(beta.problems).toEqual([]);
    expect(names(beta.uploads)).toEqual([
      'Spark-Outpost-0.1.0-beta.1-x64.zip',
      'Spark-Outpost-0.1.0-beta.1-x64.zip.blockmap',
      'Spark-Outpost-0.1.0-beta.1-x64.dmg',
      'Spark-Outpost-0.1.0-beta.1-arm64.zip',
      'Spark-Outpost-0.1.0-beta.1-arm64.zip.blockmap',
      'Spark-Outpost-0.1.0-beta.1-arm64.dmg',
      'release-notes.html',
      'Spark-Outpost-latest-x64.dmg',
      'Spark-Outpost-latest-arm64.dmg',
      'beta-mac.yml',
    ]);
    expect(beta.uploads.at(-1)!.cacheControl).toBe(CHANNEL_CACHE);
    expect(beta.uploads[0]!.cacheControl).toBe(ARTIFACT_CACHE);
  });

  it('writes both channel files, after every artifact, for a stable version', () => {
    const stable = plan('0.1.0');
    expect(stable.problems).toEqual([]);
    const order = names(stable.uploads);
    expect(order.slice(-2)).toEqual(['beta-mac.yml', 'latest-mac.yml']);
    expect(order.findIndex((name) => name.endsWith('.yml'))).toBe(9);
  });

  it('copies each versioned dmg to a latest name, uncached, after the versioned files', () => {
    const beta = plan('0.1.0-beta.1', 'publish', { 'beta-mac.yml': channel('0.1.0-beta.1') });
    const latest = beta.uploads.filter((step) => step.name.includes('-latest-'));
    expect(latest).toEqual([
      {
        name: 'Spark-Outpost-latest-x64.dmg',
        source: 'Spark-Outpost-0.1.0-beta.1-x64.dmg',
        size: 540 * MB,
        cacheControl: CHANNEL_CACHE,
      },
      {
        name: 'Spark-Outpost-latest-arm64.dmg',
        source: 'Spark-Outpost-0.1.0-beta.1-arm64.dmg',
        size: 540 * MB,
        cacheControl: CHANNEL_CACHE,
      },
    ]);
    const order = names(beta.uploads);
    expect(order.indexOf('Spark-Outpost-latest-x64.dmg')).toBeGreaterThan(
      order.indexOf('release-notes.html'),
    );
    expect(names(plan('0.1.0', 'promote').uploads)).toEqual(['latest-mac.yml']);
    expect(describePlan(beta, 'r2')).toContain(
      'Spark-Outpost-latest-arm64.dmg (copy of Spark-Outpost-0.1.0-beta.1-arm64.dmg)',
    );
  });

  it('can hold a stable build on Beta, then promote the same build to Stable', () => {
    expect(names(plan('0.1.0', 'beta-only').uploads).slice(-1)).toEqual(['beta-mac.yml']);
    const promote = plan('0.1.0', 'promote');
    expect(promote.problems).toEqual([]);
    expect(names(promote.uploads)).toEqual(['latest-mac.yml']);
    expect(promote.requiredOnFeed).toEqual([
      'Spark-Outpost-0.1.0-x64.zip',
      'Spark-Outpost-0.1.0-arm64.zip',
    ]);
  });

  it('refuses to promote a beta version, since the version is baked into the app', () => {
    expect(plan('0.1.0-beta.2', 'promote').problems[0]).toMatch(
      /beta version, so it can only go to Beta.*rebuild the same commit as 0\.1\.0/,
    );
    expect(plan('0.1.0-alpha.1').problems[0]).toMatch(/Only beta prereleases/);
  });

  it('rejects a channel file that is missing an architecture or is for another version', () => {
    const oneArch = plan('0.1.0-beta.1', 'publish', {
      'beta-mac.yml': channel('0.1.0-beta.1', ['arm64']),
    });
    expect(oneArch.problems).toEqual([
      expect.stringMatching(/doesn't list Spark-Outpost-0\.1\.0-beta\.1-x64\.zip\. Build both/),
    ]);
    const stale = plan('0.1.0-beta.2', 'publish', { 'beta-mac.yml': channel('0.1.0-beta.1') });
    expect(stale.problems[0]).toBe('beta-mac.yml is for 0.1.0-beta.1, not 0.1.0-beta.2.');
  });

  it('explains missing channel files and artifacts', () => {
    const empty = releasePlan({
      version: '0.1.0',
      mode: 'publish',
      files: [],
      channelText: () => null,
    });
    expect(empty.uploads).toEqual([]);
    expect(empty.problems).toContain(
      'Spark-Outpost-0.1.0-arm64.zip is missing from the release folder.',
    );
    expect(empty.problems).toContainEqual(
      expect.stringMatching(/^latest-mac\.yml is missing\. Build with SPARK_UPDATE_FEED_URL/),
    );
  });

  it('describes what it will upload with sizes before uploading', () => {
    const text = describePlan(plan('0.1.0-beta.1', 'publish'), 'r2:spark-releases');
    expect(text).toMatch(/^Release 0\.1\.0-beta\.1 \(publish\) to r2:spark-releases/);
    expect(text).toContain('530.0 MB  Spark-Outpost-0.1.0-beta.1-arm64.zip');
    expect(text).toMatch(/10\. +0\.0 MB {2}beta-mac\.yml/);
    expect(text).toContain('channel files go last');
  });
});

function fakeUploader(present: string[] = [], failOn?: string) {
  const uploaded: string[] = [];
  return {
    uploaded,
    uploader: {
      list: async () => present,
      upload: async (step: UploadStep) => {
        if (step.name === failOn) throw new Error('network down');
        uploaded.push(step.name);
      },
    },
  };
}

describe('runRelease', () => {
  it('uploads in plan order and stops before the channel files when an artifact fails', async () => {
    const release = plan('0.1.0-beta.1', 'publish');
    const ok = fakeUploader();
    await runRelease(release, ok.uploader, () => undefined);
    expect(ok.uploaded).toEqual(names(release.uploads));

    const failing = fakeUploader([], 'Spark-Outpost-0.1.0-beta.1-arm64.zip');
    await expect(runRelease(release, failing.uploader, () => undefined)).rejects.toThrow(
      'network down',
    );
    expect(failing.uploaded.some((name) => name.endsWith('.yml'))).toBe(false);
  });

  it('uploads nothing when the plan has problems', async () => {
    const fake = fakeUploader();
    const broken = plan('0.1.0-beta.1', 'publish', {});
    await expect(runRelease(broken, fake.uploader, () => undefined)).rejects.toThrow(
      'nothing uploaded',
    );
    expect(fake.uploaded).toEqual([]);
  });

  it('promotes only when the zips are already on the feed', async () => {
    const missing = fakeUploader(['Spark-Outpost-0.1.0-x64.zip']);
    await expect(
      runRelease(plan('0.1.0', 'promote'), missing.uploader, () => undefined),
    ).rejects.toThrow('Not on the feed yet: Spark-Outpost-0.1.0-arm64.zip');
    expect(missing.uploaded).toEqual([]);
    const ready = fakeUploader(['Spark-Outpost-0.1.0-x64.zip', 'Spark-Outpost-0.1.0-arm64.zip']);
    await runRelease(plan('0.1.0', 'promote'), ready.uploader, () => undefined);
    expect(ready.uploaded).toEqual(['latest-mac.yml']);
  });
});
