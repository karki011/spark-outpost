import { describe, expect, it } from 'vitest';
import {
  builderConfig,
  packagedGitHubApp,
  packagedSlackClientId,
  packagedHeartbeatUrl,
  releaseProblems,
  signingPlan,
  updateFeedUrl,
} from './builder-config.ts';

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

describe('packagedHeartbeatUrl', () => {
  const endpoint = 'https://spark-outpost-heartbeat.example.workers.dev/v1/heartbeat';

  it('bakes in the heartbeat address from the environment', () => {
    expect(packagedHeartbeatUrl({ SPARK_HEARTBEAT_URL: ` ${endpoint} ` })).toBe(endpoint);
  });

  it('builds without a heartbeat when none is set', () => {
    expect(packagedHeartbeatUrl({})).toBeNull();
    expect(packagedHeartbeatUrl({ SPARK_HEARTBEAT_URL: '' })).toBeNull();
  });

  it('refuses an address that is not https', () => {
    expect(() => packagedHeartbeatUrl({ SPARK_HEARTBEAT_URL: 'http://example.com/hb' })).toThrow(
      /must be an https address/,
    );
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

  it('signs the dmg only with a Developer ID certificate', () => {
    const adHoc = builderConfig({ ...base, archs: ['x64'], env: {} });
    const signed = builderConfig({
      ...base,
      archs: ['x64'],
      env: { CSC_NAME: 'Developer ID Application: Me (TEAM123)' },
    });

    expect(adHoc.dmg).toMatchObject({ sign: false, writeUpdateInfo: false });
    expect(signed.dmg).toMatchObject({ sign: true, writeUpdateInfo: false });
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

  it('writes the heartbeat address into the packaged manifest only when set', () => {
    const endpoint = 'https://spark-outpost-heartbeat.example.workers.dev/v1/heartbeat';
    const withBeat = builderConfig({
      ...base,
      archs: ['x64'],
      env: { SPARK_HEARTBEAT_URL: endpoint },
    });
    const without = builderConfig({ ...base, archs: ['x64'], env: {} });

    expect(withBeat.extraMetadata).toMatchObject({ heartbeatUrl: endpoint });
    expect(without.extraMetadata).not.toHaveProperty('heartbeatUrl');
  });

  it('writes the GitHub App client ID and slug into the packaged manifest only when set', () => {
    const env = { SPARK_GITHUB_APP_CLIENT_ID: 'Iv23liExample', SPARK_GITHUB_APP_SLUG: 'spark' };
    expect(builderConfig({ ...base, archs: ['x64'], env }).extraMetadata).toMatchObject({
      githubApp: { clientId: 'Iv23liExample', slug: 'spark' },
    });
    const off = { SPARK_GITHUB_APP_CLIENT_ID: '', SPARK_GITHUB_APP_SLUG: '' };
    expect(builderConfig({ ...base, archs: ['x64'], env: off }).extraMetadata).not.toHaveProperty(
      'githubApp',
    );
    expect(builderConfig({ ...base, archs: ['x64'], env: {} }).extraMetadata).toMatchObject({
      githubApp: { clientId: 'Iv23li7XhI8fUF6WSltL', slug: 'spark-outpost' },
    });
  });

  it('bakes the Slack client ID only when one is set, and nothing by default', () => {
    const env = { SPARK_SLACK_CLIENT_ID: ' 1234567890.9876543210 ' };
    expect(packagedSlackClientId(env)).toBe('1234567890.9876543210');
    expect(builderConfig({ ...base, archs: ['x64'], env }).extraMetadata).toMatchObject({
      slackApp: { clientId: '1234567890.9876543210' },
    });
    expect(packagedSlackClientId({})).toBeNull();
    expect(builderConfig({ ...base, archs: ['x64'], env: {} }).extraMetadata).not.toHaveProperty(
      'slackApp',
    );
  });

  it('refuses a Slack value that is not a client ID, such as a secret or a token', () => {
    for (const value of ['0123456789abcdef0123456789abcdef', 'xoxp-1234567890-abcdefgh']) {
      expect(() => packagedSlackClientId({ SPARK_SLACK_CLIENT_ID: value })).toThrow(
        /Never a client secret/,
      );
    }
  });
});

describe('packagedGitHubApp', () => {
  it('reads the client ID and slug from the environment, else the built-in App', () => {
    const env = { SPARK_GITHUB_APP_CLIENT_ID: ' Iv23liExample ', SPARK_GITHUB_APP_SLUG: 'spark' };
    const ids = { clientId: 'Iv23liExample', slug: 'spark' };
    expect(packagedGitHubApp(env)).toEqual(ids);
    expect(
      packagedGitHubApp({ SPARK_GITHUB_APP_CLIENT_ID: '', SPARK_GITHUB_APP_SLUG: '' }),
    ).toBeNull();
    expect(packagedGitHubApp({})).toEqual({
      clientId: 'Iv23li7XhI8fUF6WSltL',
      slug: 'spark-outpost',
    });
  });

  it('refuses values that do not look like a client ID and slug', () => {
    expect(() => packagedGitHubApp({ SPARK_GITHUB_APP_CLIENT_ID: 'a secret value' })).toThrow(
      /client ID/,
    );
    expect(() =>
      packagedGitHubApp({ SPARK_GITHUB_APP_CLIENT_ID: 'Iv23li', SPARK_GITHUB_APP_SLUG: 'a/b' }),
    ).toThrow(/URL name/);
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
