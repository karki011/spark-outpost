import { describe, expect, it } from 'vitest';
import { builderConfig, releaseProblems, signingPlan, updateFeedUrl } from './builder-config.ts';

const NOTARY = {
  APPLE_ID: 'me@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-password',
  APPLE_TEAM_ID: 'TEAM123',
};

describe('signingPlan', () => {
  it('signs ad hoc and never notarizes without a Developer ID certificate', () => {
    expect(signingPlan({})).toEqual({ adHoc: true, notarize: false });
    expect(signingPlan(NOTARY)).toEqual({ adHoc: true, notarize: false });
  });

  it('notarizes only with a certificate and complete notary credentials', () => {
    expect(signingPlan({ CSC_NAME: 'Developer ID Application: Me' })).toEqual({
      adHoc: false,
      notarize: false,
    });
    expect(signingPlan({ CSC_LINK: '/certs/id.p12', ...NOTARY })).toEqual({
      adHoc: false,
      notarize: true,
    });
    expect(
      signingPlan({ CSC_LINK: '/certs/id.p12', APPLE_ID: 'me@example.com', APPLE_TEAM_ID: 'T' }),
    ).toEqual({ adHoc: false, notarize: false });
  });
});

describe('updateFeedUrl', () => {
  it('reads the one feed setting and trims trailing slashes', () => {
    expect(updateFeedUrl({ SPARK_UPDATE_FEED_URL: 'https://updates.example.com/spark/' })).toBe(
      'https://updates.example.com/spark',
    );
  });

  it('builds without an update feed when none is set', () => {
    expect(updateFeedUrl({})).toBeNull();
    expect(updateFeedUrl({ SPARK_UPDATE_FEED_URL: '  ' })).toBeNull();
  });
});

describe('builderConfig', () => {
  const base = {
    stageDir: '/stage',
    outputDir: '/out',
    version: '0.2.0',
    electronVersion: '44.4.5',
    archs: ['x64', 'arm64'] as const,
    entitlements: '/build/entitlements.mac.plist',
    icon: '/build/icon.icns',
  };

  it('names the packaged app after the prod channel and builds zip and dmg per arch', () => {
    const config = builderConfig({ ...base, archs: [...base.archs], env: {} });
    expect(config).toMatchObject({
      appId: 'ai.spark-outpost.app',
      productName: 'Spark Outpost',
      extraMetadata: { version: '0.2.0' },
      publish: null,
      mac: {
        icon: '/build/icon.icns',
        identity: '-',
        notarize: false,
        target: [
          { target: 'zip', arch: ['x64', 'arm64'] },
          { target: 'dmg', arch: ['x64', 'arm64'] },
        ],
      },
    });
  });

  it('publishes update files for every channel to the generic feed', () => {
    const config = builderConfig({
      ...base,
      archs: ['x64'],
      env: { SPARK_UPDATE_FEED_URL: 'http://127.0.0.1:8080/feed' },
    });
    expect(config.publish).toEqual([{ provider: 'generic', url: 'http://127.0.0.1:8080/feed' }]);
    expect(config.generateUpdatesFilesForAllChannels).toBe(true);
  });
});

describe('releaseProblems', () => {
  const ready = {
    CSC_NAME: 'Developer ID Application: Me (TEAM123)',
    ...NOTARY,
    SPARK_UPDATE_FEED_URL: 'https://updates.example.com',
  };

  it('accepts a signed, notarized two-arch build with a feed', () => {
    expect(releaseProblems(ready, ['x64', 'arm64'])).toEqual([]);
  });

  it('fails clearly without the Developer ID certificate', () => {
    const problems = releaseProblems({ ...ready, CSC_NAME: undefined }, ['x64', 'arm64']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^CSC_NAME is not set\. .*Developer ID Application/);
  });

  it('names every other missing piece', () => {
    const problems = releaseProblems({ CSC_NAME: ready.CSC_NAME }, ['arm64']);
    expect(problems.map((problem) => problem.split('.')[0])).toEqual([
      'Notarization credentials are missing',
      'No update feed',
      'A release builds Apple silicon and Intel together so one channel file lists both',
    ]);
  });
});
