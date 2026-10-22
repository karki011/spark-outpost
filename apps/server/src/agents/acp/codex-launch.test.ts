import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunCommand } from '../../setup/command.ts';
import { agentDefinitions, codexConfig } from './agents.ts';
import {
  atLeast,
  CODEX_PROFILES_FROM,
  codexVersion,
  isCodexConfigFailure,
  prepareCodexLaunch,
  startupOverrides,
  supportsPermissionProfiles,
  tomlInline,
} from './codex-launch.ts';
import { codexPermissionProfiles } from './codex-permissions.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'codex-launch-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const reporting =
  (stdout: string, code = 0): RunCommand =>
  async () => ({ code, stdout, stderr: '' });

describe('Codex permission profile support', () => {
  it.each([
    ['0.156.1', true],
    ['0.157.0', true],
    ['0.160.0', true],
    ['0.200.3', true],
    ['1.0.0', true],
    [CODEX_PROFILES_FROM, true],
    ['0.149.0', false],
    ['0.148.0', false],
    ['0.140.0', false],
  ])('profiles for %s: %s', (version, supported) => {
    expect(supportsPermissionProfiles(version)).toBe(supported);
  });

  it('keeps profiles when the version cannot be read', () => {
    expect(supportsPermissionProfiles(null)).toBe(true);
  });

  it('compares versions numerically', () => {
    expect(atLeast('0.157.0', '0.99.0')).toBe(true);
    expect(atLeast('0.9.0', '0.149.1')).toBe(false);
  });
});

describe('Codex config shape per version', () => {
  const shape = (profiles: boolean) => codexConfig(true, null, profiles) as Record<string, unknown>;

  it.each(['0.156.1', '0.157.0', '0.160.0'])('defines the profile table on %s', async (version) => {
    const launch = await prepareCodexLaunch(
      { CODEX_PATH: `/bin/codex-${version}` },
      dir,
      false,
      reporting(`codex-cli ${version}\n`),
    );
    expect(launch.profiles).toBe(true);
    const config = shape(launch.profiles);
    expect(config.default_permissions).toBe('read-only');
    expect(Object.keys(config.permissions as object)).toContain('read-only');
    expect(Object.keys(config.permissions as object)).toContain('ask-every-action');
  });

  it('leaves the profile table out for a Codex that predates it', async () => {
    const launch = await prepareCodexLaunch(
      { CODEX_PATH: '/bin/codex-old' },
      dir,
      false,
      reporting('codex-cli 0.145.0\n'),
    );
    expect(launch.profiles).toBe(false);
    const config = shape(launch.profiles);
    expect(config).not.toHaveProperty('default_permissions');
    expect(config).not.toHaveProperty('permissions');
    expect(config).toMatchObject({ features: { shell_tool: true } });
    expect(config).not.toHaveProperty('web_search');
  });

  it('never sets a default without its table', () => {
    for (const profiles of [true, false]) {
      const config = shape(profiles);
      expect('default_permissions' in config).toBe('permissions' in config);
    }
  });

  it('builds the legacy environment for the plain sandbox', () => {
    const env = agentDefinitions.codex.conversationEnv?.('/tmp/run', true, null, false) ?? {};
    expect(env).toMatchObject({ INITIAL_AGENT_MODE: 'read-only' });
    expect(JSON.parse(env.CODEX_CONFIG ?? '{}')).not.toHaveProperty('permissions');
  });

  it('forces the plain sandbox when asked to retry', async () => {
    const launch = await prepareCodexLaunch(
      { CODEX_PATH: '/bin/codex-new' },
      dir,
      true,
      reporting('codex-cli 0.157.0\n'),
    );
    expect(launch.profiles).toBe(false);
  });
});

describe('Codex startup wrapper', () => {
  it.skipIf(process.platform === 'win32')(
    'starts the user Codex with a valid default so a dangling one in their config cannot stop it',
    async () => {
      const launch = await prepareCodexLaunch(
        { CODEX_PATH: "/Users/o'brien/bin/codex" },
        dir,
        false,
        reporting('codex-cli 0.157.0\n'),
      );
      const wrapper = launch.cli.CODEX_PATH!;
      expect(wrapper).toBe(join(dir, 'codex-spark'));
      expect((await stat(wrapper)).mode & 0o111).not.toBe(0);
      const script = await readFile(wrapper, 'utf8');
      expect(
        script.startsWith(`#!/bin/sh\nexec '/Users/o'\\''brien/bin/codex' -c 'permissions={ `),
      ).toBe(true);
      expect(script).toContain(`"read-only" = { "extends" = ":read-only"`);
      expect(script.endsWith(` -c 'default_permissions="read-only"' "$@"\n`)).toBe(true);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'starts the plain sandbox with the built-in read-only default and no table',
    async () => {
      const launch = await prepareCodexLaunch(
        { CODEX_PATH: '/usr/local/bin/codex' },
        dir,
        true,
        reporting('codex-cli 0.157.0\n'),
      );
      expect(await readFile(launch.cli.CODEX_PATH!, 'utf8')).toBe(
        `#!/bin/sh\nexec '/usr/local/bin/codex' -c 'default_permissions=":read-only"' "$@"\n`,
      );
    },
  );

  it('names every mode profile in the startup table, so no thread can lack one', () => {
    const [table, fallback] = startupOverrides(true);
    for (const mode of Object.keys(codexPermissionProfiles())) {
      expect(table).toContain(`${JSON.stringify(mode)} = {`);
    }
    expect(fallback).toBe('default_permissions="read-only"');
    expect(startupOverrides(false)).toEqual(['default_permissions=":read-only"']);
  });

  it('writes inline TOML with quoted keys', () => {
    expect(tomlInline({ ':root': 'write', network: { enabled: true }, list: [1, 'a'] })).toBe(
      '{ ":root" = "write", "network" = { "enabled" = true }, "list" = [1, "a"] }',
    );
  });

  it('leaves a Codex too old for profiles alone', async () => {
    const launch = await prepareCodexLaunch(
      { CODEX_PATH: '/bin/codex-old' },
      dir,
      false,
      reporting('codex-cli 0.140.0\n'),
    );
    expect(launch.cli).toEqual({ CODEX_PATH: '/bin/codex-old' });
  });

  it('passes through when no Codex was located', async () => {
    const launch = await prepareCodexLaunch({}, dir, false, reporting(''));
    expect(launch).toEqual({ cli: {}, profiles: true, version: null });
  });
});

describe('codexVersion', () => {
  it('reads the version once per path', async () => {
    let calls = 0;
    const run: RunCommand = async () => {
      calls += 1;
      return { code: 0, stdout: 'codex-cli 0.157.0\n', stderr: '' };
    };
    expect(await codexVersion('/bin/codex-cached', run)).toBe('0.157.0');
    expect(await codexVersion('/bin/codex-cached', run)).toBe('0.157.0');
    expect(calls).toBe(1);
  });

  it('is unknown when the command fails or prints nothing useful', async () => {
    expect(await codexVersion('/bin/codex-fails', reporting('', 1))).toBeNull();
    expect(await codexVersion('/bin/codex-blank', reporting('hello'))).toBeNull();
    expect(
      await codexVersion('/bin/codex-throws', async () => {
        throw new Error('nope');
      }),
    ).toBeNull();
  });
});

describe('isCodexConfigFailure', () => {
  it.each([
    'failed to load configuration: default_permissions requires a `[permissions]` table',
    'Internal error: failed to load workspace requirements',
    'default_permissions refers to undefined profile `read-only`',
  ])('recognises %s', (message) => {
    expect(isCodexConfigFailure(message)).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isCodexConfigFailure('Codex is rate limited')).toBe(false);
  });
});
