import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const CODEX_SANDBOX_TRIGGER = '#sandboxed ';

function codexScript(): string {
  const require = createRequire(import.meta.url);
  const acpManifest = require.resolve('@agentclientprotocol/codex-acp/package.json');
  const codexManifest = createRequire(acpManifest).resolve('@openai/codex/package.json');
  return join(dirname(codexManifest), 'bin', 'codex.js');
}

function toml(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const fields = Object.entries(value).map(
      ([key, child]) => `${JSON.stringify(key)}=${toml(child)}`,
    );
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

function sandboxArgs(mode: string): string[] | null {
  const config = JSON.parse(process.env.CODEX_CONFIG ?? '{}') as { permissions?: object };
  const profile = (config.permissions as Record<string, unknown> | undefined)?.[mode];
  if (!profile) return null;
  return [
    '-c',
    `default_permissions=${JSON.stringify(mode)}`,
    '-c',
    `permissions.${mode}=${toml(profile)}`,
  ];
}

export function runSandboxed(text: string, cwd: string, mode: string): string {
  const command = text.slice(text.indexOf(CODEX_SANDBOX_TRIGGER) + CODEX_SANDBOX_TRIGGER.length);
  const shell = ['sh', '-c', command.split('\n')[0]!];
  const sandbox = sandboxArgs(mode);
  const codexHome = mkdtempSync(join(tmpdir(), 'fake-codex-home-'));
  try {
    const result = sandbox
      ? spawnSync(process.execPath, [codexScript(), 'sandbox', ...sandbox, '--', ...shell], {
          cwd,
          encoding: 'utf8',
          env: { ...process.env, CODEX_HOME: codexHome },
        })
      : spawnSync(shell[0]!, shell.slice(1), { cwd, encoding: 'utf8' });
    return `sandbox=${sandbox ? mode : 'none'}\n${result.stdout}${result.stderr}`;
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
}
