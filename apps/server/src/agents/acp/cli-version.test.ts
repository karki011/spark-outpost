import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunCommand } from '../../setup/command.ts';
import {
  atLeast,
  CLAUDE_MCP_STDIN_FROM,
  claudeReadsMcpOverStdin,
  cliVersion,
} from './cli-version.ts';

const reporting =
  (stdout: string, code = 0): RunCommand =>
  async () => ({ code, stdout, stderr: '' });

function bundledClaudeCodeVersion(): string {
  const adapter = createRequire(import.meta.url).resolve(
    '@agentclientprotocol/claude-agent-acp/package.json',
  );
  const sdk = join(
    dirname(createRequire(adapter).resolve('@anthropic-ai/claude-agent-sdk')),
    'package.json',
  );
  return (JSON.parse(readFileSync(sdk, 'utf8')) as { claudeCodeVersion: string }).claudeCodeVersion;
}

describe('atLeast', () => {
  it('compares versions numerically', () => {
    expect(atLeast('0.157.0', '0.99.0')).toBe(true);
    expect(atLeast('0.9.0', '0.149.1')).toBe(false);
    expect(atLeast('2.1.326', '2.1.326')).toBe(true);
  });
});

describe('cliVersion', () => {
  it('reads the version once per path', async () => {
    let calls = 0;
    const run: RunCommand = async () => {
      calls += 1;
      return { code: 0, stdout: 'codex-cli 0.157.0\n', stderr: '' };
    };
    expect(await cliVersion('/bin/codex-cached', run)).toBe('0.157.0');
    expect(await cliVersion('/bin/codex-cached', run)).toBe('0.157.0');
    expect(calls).toBe(1);
  });

  it('is unknown when the command fails or prints nothing useful', async () => {
    expect(await cliVersion('/bin/codex-fails', reporting('', 1))).toBeNull();
    expect(await cliVersion('/bin/codex-blank', reporting('hello'))).toBeNull();
    expect(
      await cliVersion('/bin/codex-throws', async () => {
        throw new Error('nope');
      }),
    ).toBeNull();
  });
});

describe('MCP servers over stdin for Claude', () => {
  it('needs the Claude Code bundled with the pinned Agent SDK, or newer', () => {
    expect(CLAUDE_MCP_STDIN_FROM).toBe(bundledClaudeCodeVersion());
  });

  it('is used only with a located Claude Code at least that version', async () => {
    const at = (version: string) => ({ CLAUDE_CODE_EXECUTABLE: `/bin/claude-${version}` });
    const run = (version: string) => reporting(`${version} (Claude Code)\n`);
    expect(await claudeReadsMcpOverStdin(at('2.1.326'), run('2.1.326'))).toBe(true);
    expect(await claudeReadsMcpOverStdin(at('2.2.0'), run('2.2.0'))).toBe(true);
    expect(await claudeReadsMcpOverStdin(at('2.1.301'), run('2.1.301'))).toBe(false);
    expect(await claudeReadsMcpOverStdin(at('unknown'), reporting('', 1))).toBe(false);
    expect(await claudeReadsMcpOverStdin({}, run('2.2.0'))).toBe(false);
  });
});
