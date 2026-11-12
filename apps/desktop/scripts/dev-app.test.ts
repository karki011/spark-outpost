import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
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
  prepareDevApp,
  setInfoPlist,
  withEntitlements,
  type DevAppDeps,
  type DevAppSource,
  type SigningIdentity,
} from './dev-app.ts';

const FIND_IDENTITY = `
  1) 1111111111111111111111111111111111111111 "Local Signing"
  2) 2222222222222222222222222222222222222222 "Apple Development: Pat Doe (AAAAAAAAAA)"
  3) 3333333333333333333333333333333333333333 "Developer ID Application: Pat Doe (ABCDE12345)"
     3 valid identities found
`;

describe('pickIdentity', () => {
  it('uses CSC_NAME without asking the keychain', async () => {
    let asked = false;
    const identity = await pickIdentity({ CSC_NAME: ' Pat Doe (ABCDE12345) ' }, () => {
      asked = true;
      return Promise.resolve(FIND_IDENTITY);
    });
    expect(identity).toEqual({
      kind: 'developer-id',
      sign: 'Pat Doe (ABCDE12345)',
      label: 'Pat Doe (ABCDE12345)',
    });
    expect(asked).toBe(false);
  });

  it('picks the first Developer ID Application identity by its hash', async () => {
    const identity = await pickIdentity({}, () => Promise.resolve(FIND_IDENTITY));
    expect(identity).toEqual({
      kind: 'developer-id',
      sign: '3333333333333333333333333333333333333333',
      label: 'Developer ID Application: Pat Doe (ABCDE12345)',
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
      'NSAudioCaptureUsageDescription',
      'NSSpeechRecognitionUsageDescription',
      'NSCalendarsFullAccessUsageDescription',
      'NSAppleEventsUsageDescription',
    ])
      expect(edits.get(key)).toMatch(/^Spark Outpost Dev /);
    expect(edits.has('CFBundleExecutable')).toBe(false);
  });
});

describe('setInfoPlist', () => {
  it('inserts missing keys and replaces existing ones', async () => {
    const existing = new Set(['CFBundleName']);
    const calls: string[][] = [];
    const run = (_command: string, args: string[]) => {
      calls.push(args);
      const fails = args[0] === '-insert' && existing.has(args[1]!);
      return fails ? Promise.reject(new Error('exists')) : Promise.resolve('');
    };
    await setInfoPlist(run, '/x/Info.plist', [
      ['CFBundleName', 'Spark Outpost Dev'],
      ['NSAppleEventsUsageDescription', 'Why'],
    ]);
    expect(calls).toEqual([
      ['-insert', 'CFBundleName', '-string', 'Spark Outpost Dev', '/x/Info.plist'],
      ['-replace', 'CFBundleName', '-string', 'Spark Outpost Dev', '/x/Info.plist'],
      ['-insert', 'NSAppleEventsUsageDescription', '-string', 'Why', '/x/Info.plist'],
    ]);
  });

  it.runIf(process.platform === 'darwin')(
    'patches a real plist that lacks the usage keys with plutil',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'spark-dev-app-'));
      const plist = path.join(dir, 'Info.plist');
      await writeFile(
        plist,
        '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleName</key><string>Electron</string><key>CFBundleIdentifier</key><string>com.example.Electron</string></dict></plist>\n',
      );
      const run = (command: string, args: string[]) =>
        promisify(execFile)(command, args).then(({ stdout }) => stdout);
      try {
        await setInfoPlist(run, plist, infoPlistEdits());
        const json = await run('plutil', ['-convert', 'json', '-o', '-', plist]);
        expect(JSON.parse(json)).toEqual(Object.fromEntries(infoPlistEdits()));
        expect(await readFile(plist, 'utf8')).toContain('<key>NSAppleEventsUsageDescription</key>');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
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
  it('passes the calendar test seed variables and nothing else from the environment', () => {
    const args = openArgs({
      app: '/a.app',
      appDir: '/r/apps/desktop',
      port: null,
      passEnv: {
        SPARK_CALENDAR_SEED: 'seed',
        SPARK_CALENDAR_SEED_STATE: '/tmp/s.json',
        SPARK_CALENDAR_SEED_ONE: '12',
        HOME: '/u',
      },
    });
    expect(args).toEqual([
      '-W',
      '-n',
      '-a',
      '/a.app',
      '--env',
      'SPARK_CALENDAR_SEED=seed',
      '--env',
      'SPARK_CALENDAR_SEED_STATE=/tmp/s.json',
      '--env',
      'SPARK_CALENDAR_SEED_ONE=12',
      '--args',
      '/r/apps/desktop',
    ]);
  });

  it('opens no debug port unless one is asked for', () => {
    const args = openArgs({ app: '/a.app', appDir: '/r/apps/desktop', port: null });
    expect(args).toEqual(['-W', '-n', '-a', '/a.app', '--args', '/r/apps/desktop']);
  });

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
  it('turns the debug port on only for --port or --debug', () => {
    expect(parsePort(undefined, false)).toBeNull();
    expect(parsePort(undefined, true)).toBe(DEFAULT_DEBUG_PORT);
    expect(parsePort('9401', false)).toBe(9401);
  });

  it('rejects ports that are not usable', () => {
    expect(() => parsePort('80', false)).toThrow(/--port/);
    expect(() => parsePort('nine', true)).toThrow(/--port/);
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
  it('requires the built shell and web app and only warns about the helper and the addon', () => {
    const present = new Set(['/r/apps/desktop/dist/main.js']);
    const result = missingPrerequisites('/r/apps/desktop', 'arm64', (file) => present.has(file));
    expect(result.missing).toEqual(['/r/apps/web/dist/index.html']);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('/r/.local/mac-control/arm64/spark-mac-control');
    expect(result.warnings[1]).toContain('/r/.local/no-activate/arm64/no-activate.node');
  });
});

describe('designatedRequirement', () => {
  it('reads the requirement line from codesign output', () => {
    const output =
      'Executable=/x/Contents/MacOS/Electron\ndesignated => identifier "com.sparkoutpost.dev" and certificate leaf[subject.OU] = ABCDE12345\n';
    expect(designatedRequirement(output)).toBe(
      'identifier "com.sparkoutpost.dev" and certificate leaf[subject.OU] = ABCDE12345',
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
      '-insert',
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
