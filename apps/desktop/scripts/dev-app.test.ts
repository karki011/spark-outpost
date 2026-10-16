import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appDirPlan,
  DEFAULT_DEBUG_PORT,
  designatedRequirement,
  desktopDir,
  infoPlistEdits,
  missingPrerequisites,
  openArgs,
  parsePort,
  pickIdentity,
  plutilStringEdits,
  prepareDevApp,
  withEntitlements,
  type DevAppDeps,
  type DevAppSource,
  type SigningIdentity,
} from './dev-app.ts';

const FIND_IDENTITY = `
  1) 18D6F1EADE7A0A5F2F6BD25D37054395847AC0E0 "Local Signing"
  2) B9E61D4DC21AE981B59F5E27C311189189241EC1 "Apple Development: Pat Doe (AAAAAAAAAA)"
  3) 5456F3240831FDFD31B019F56CF254DF1C40C7B9 "Developer ID Application: Pat Doe (Z825V2BBX9)"
     3 valid identities found
`;

describe('pickIdentity', () => {
  it('uses CSC_NAME without asking the keychain', async () => {
    let asked = false;
    const identity = await pickIdentity({ CSC_NAME: ' Pat Doe (Z825V2BBX9) ' }, () => {
      asked = true;
      return Promise.resolve(FIND_IDENTITY);
    });
    expect(identity).toEqual({
      kind: 'developer-id',
      sign: 'Pat Doe (Z825V2BBX9)',
      label: 'Pat Doe (Z825V2BBX9)',
    });
    expect(asked).toBe(false);
  });

  it('picks the first Developer ID Application identity by its hash', async () => {
    const identity = await pickIdentity({}, () => Promise.resolve(FIND_IDENTITY));
    expect(identity).toEqual({
      kind: 'developer-id',
      sign: '5456F3240831FDFD31B019F56CF254DF1C40C7B9',
      label: 'Developer ID Application: Pat Doe (Z825V2BBX9)',
    });
  });

  it('falls back to ad hoc when only development identities exist', async () => {
    const output = FIND_IDENTITY.split('\n').slice(0, 3).join('\n');
    expect(await pickIdentity({ CSC_NAME: '' }, () => Promise.resolve(output))).toEqual({
      kind: 'ad-hoc',
    });
  });
});

describe('infoPlistEdits', () => {
  it('names the dev app and adds the usage strings', () => {
    const edits = new Map(infoPlistEdits());
    expect(edits.get('CFBundleIdentifier')).toBe('com.sparkoutpost.dev');
    expect(edits.get('CFBundleName')).toBe('Spark Outpost Dev');
    expect(edits.get('CFBundleDisplayName')).toBe('Spark Outpost Dev');
    for (const key of [
      'NSMicrophoneUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'NSCalendarsFullAccessUsageDescription',
      'NSAppleEventsUsageDescription',
    ])
      expect(edits.get(key)).toMatch(/^Spark Outpost Dev /);
    expect(edits.has('CFBundleExecutable')).toBe(false);
  });

  it('writes each value as a string replacement in the given plist', () => {
    expect(plutilStringEdits('/x/Info.plist', [['CFBundleName', 'Spark Outpost Dev']])).toEqual([
      ['-replace', 'CFBundleName', '-string', 'Spark Outpost Dev', '/x/Info.plist'],
    ]);
  });
});

const BASE_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
  </dict>
</plist>
`;

describe('withEntitlements', () => {
  it('keeps the base entitlements and adds the missing ones once', () => {
    const xml = withEntitlements(BASE_ENTITLEMENTS, [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.device.audio-input',
    ]);
    expect(xml.match(/allow-jit/g)).toHaveLength(1);
    expect(xml).toContain(
      '<key>com.apple.security.device.audio-input</key>\n    <true/>\n  </dict>\n</plist>',
    );
  });

  it('refuses a file without a dict', () => {
    expect(() => withEntitlements('<plist/>', ['x'])).toThrow(/dict/);
  });
});

describe('openArgs', () => {
  it('waits on a new instance, passes the data folder and the debug port', () => {
    expect(
      openArgs({
        app: '/d/Spark Outpost Dev.app',
        appDir: '/r/apps/desktop',
        port: 9400,
        dataDir: '/data',
      }),
    ).toEqual([
      '-W',
      '-n',
      '-a',
      '/d/Spark Outpost Dev.app',
      '--env',
      'SPARK_APP_DATA=/data',
      '--args',
      '/r/apps/desktop',
      '--remote-debugging-port=9400',
    ]);
  });

  it('leaves the data folder to the app when none is given', () => {
    expect(openArgs({ app: '/a.app', appDir: '/r/apps/desktop', port: 9333 })).not.toContain(
      '--env',
    );
  });
});

describe('parsePort', () => {
  it('defaults and rejects ports that are not usable', () => {
    expect(parsePort(undefined)).toBe(DEFAULT_DEBUG_PORT);
    expect(parsePort('9401')).toBe(9401);
    expect(() => parsePort('80')).toThrow(/--port/);
    expect(() => parsePort('nine')).toThrow(/--port/);
  });
});

describe('appDirPlan', () => {
  it('launches a plain path as it is', () => {
    expect(appDirPlan('/Users/a/spark/apps/desktop', '/private/tmp')).toEqual({
      launchDir: '/Users/a/spark/apps/desktop',
      link: null,
    });
  });

  it('links a repo under a dot folder from the temp folder, one link per repo', () => {
    const appDir = '/Users/a/spark/.claude/worktrees/one/apps/desktop';
    const plan = appDirPlan(appDir, '/private/tmp');
    expect(plan.link?.target).toBe('/Users/a/spark/.claude/worktrees/one');
    expect(path.dirname(plan.link!.path)).toBe('/private/tmp');
    expect(plan.launchDir).toBe(path.join(plan.link!.path, 'apps/desktop'));
    expect(plan.launchDir).not.toMatch(/\/\./);
    expect(appDirPlan(appDir, '/private/tmp')).toEqual(plan);
    const other = appDirPlan('/Users/a/spark/.claude/worktrees/two/apps/desktop', '/private/tmp');
    expect(other.link?.path).not.toBe(plan.link?.path);
  });
});

describe('desktopDir', () => {
  it('accepts a checkout root or its apps/desktop folder', () => {
    const exists = (file: string) => file === '/r/apps/desktop/package.json';
    expect(desktopDir('/r', exists)).toBe('/r/apps/desktop');
    expect(desktopDir('/r/apps/desktop', exists)).toBe('/r/apps/desktop');
  });
});

describe('missingPrerequisites', () => {
  it('requires the built shell and web app and only warns about the Mac control helper', () => {
    const present = new Set(['/r/apps/desktop/dist/main.js']);
    const result = missingPrerequisites('/r/apps/desktop', 'arm64', (file) => present.has(file));
    expect(result.missing).toEqual(['/r/apps/web/dist/index.html']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('/r/.local/mac-control/arm64/spark-mac-control');
  });
});

describe('designatedRequirement', () => {
  it('reads the requirement line from codesign output', () => {
    const output =
      'Executable=/x/Contents/MacOS/Electron\ndesignated => identifier "com.sparkoutpost.dev" and certificate leaf[subject.OU] = Z825V2BBX9\n';
    expect(designatedRequirement(output)).toBe(
      'identifier "com.sparkoutpost.dev" and certificate leaf[subject.OU] = Z825V2BBX9',
    );
    expect(designatedRequirement('Executable=/x')).toBeNull();
  });
});

const DEVELOPER_ID: SigningIdentity = {
  kind: 'developer-id',
  sign: 'ABC',
  label: 'Developer ID Application: Pat',
};

function fakeDeps(files: Map<string, string>, failVerify = false) {
  const calls: string[][] = [];
  const deps: DevAppDeps = {
    run: (command, args) => {
      calls.push([command, ...args]);
      if (failVerify && command === 'codesign' && args[0] === '--verify')
        return Promise.reject(new Error('invalid'));
      if (command === 'codesign' && args[0] === '-d')
        return Promise.resolve('designated => identifier "com.sparkoutpost.dev"\n');
      return Promise.resolve('');
    },
    readText: (file) => Promise.resolve(files.get(file) ?? null),
    writeText: (file, text) => {
      files.set(file, text);
      return Promise.resolve();
    },
    remove: (file) => {
      calls.push(['rm', file]);
      files.delete(file);
      return Promise.resolve();
    },
    makeDir: () => Promise.resolve(),
    log: () => undefined,
  };
  return { deps, calls };
}

function source(identity: SigningIdentity = DEVELOPER_ID, version = '44.4.5'): DevAppSource {
  return {
    electronApp: '/repo/node_modules/electron/dist/Electron.app',
    electronVersion: version,
    baseEntitlements: '/repo/build/entitlements.mac.plist',
    devDir: '/main/.local/dev-app',
    identity,
  };
}

describe('prepareDevApp', () => {
  const app = '/main/.local/dev-app/Spark Outpost Dev.app';

  it('copies, patches, signs with entitlements and records a stamp', async () => {
    const files = new Map([['/repo/build/entitlements.mac.plist', BASE_ENTITLEMENTS]]);
    const { deps, calls } = fakeDeps(files);
    const result = await prepareDevApp(source(), deps);
    expect(result).toEqual({
      app,
      reused: false,
      requirement: 'identifier "com.sparkoutpost.dev"',
    });
    expect(calls).toContainEqual(['ditto', '/repo/node_modules/electron/dist/Electron.app', app]);
    expect(calls).toContainEqual([
      'plutil',
      '-replace',
      'CFBundleIdentifier',
      '-string',
      'com.sparkoutpost.dev',
      `${app}/Contents/Info.plist`,
    ]);
    expect(files.get('/main/.local/dev-app/entitlements.plist')).toContain(
      '<key>com.apple.security.device.audio-input</key>',
    );
    expect(calls).toContainEqual([
      'codesign',
      '--force',
      '--deep',
      '--options',
      'runtime',
      '--timestamp=none',
      '--entitlements',
      '/main/.local/dev-app/entitlements.plist',
      '--sign',
      'ABC',
      app,
    ]);
    expect(
      calls.some((call) => call.some((arg) => arg.includes('node_modules') && call[0] !== 'ditto')),
    ).toBe(false);
    expect(files.has('/main/.local/dev-app/stamp.json')).toBe(true);
  });

  it('reuses a valid copy for the same Electron and identity', async () => {
    const files = new Map([['/repo/build/entitlements.mac.plist', BASE_ENTITLEMENTS]]);
    await prepareDevApp(source(), fakeDeps(files).deps);
    const { deps, calls } = fakeDeps(files);
    const result = await prepareDevApp(source(), deps);
    expect(result.reused).toBe(true);
    expect(calls.map((call) => call[0])).toEqual(['codesign', 'codesign']);
  });

  it('rebuilds when Electron, the identity or the signature changes', async () => {
    const files = new Map([['/repo/build/entitlements.mac.plist', BASE_ENTITLEMENTS]]);
    await prepareDevApp(source(), fakeDeps(files).deps);
    expect((await prepareDevApp(source(DEVELOPER_ID, '45.0.0'), fakeDeps(files).deps)).reused).toBe(
      false,
    );
    expect(
      (await prepareDevApp(source({ kind: 'ad-hoc' }, '45.0.0'), fakeDeps(files).deps)).reused,
    ).toBe(false);
    const broken = fakeDeps(files, true);
    await expect(prepareDevApp(source({ kind: 'ad-hoc' }, '45.0.0'), broken.deps)).rejects.toThrow(
      'invalid',
    );
    expect(broken.calls).toContainEqual([
      'ditto',
      '/repo/node_modules/electron/dist/Electron.app',
      app,
    ]);
  });
});
