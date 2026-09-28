import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpServerConfig } from '../agent-config/mcp-json.ts';
import { probeMcpServer } from './probe.ts';

const ECHO = join(import.meta.dirname, '../../test/echo-mcp-server.mjs');

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spark-mcp-probe-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const stdio = (args: string[], env: Record<string, string> = {}): McpServerConfig => ({
  name: 'echo',
  transport: 'stdio',
  command: process.execPath,
  args,
  url: null,
  env,
  headers: {},
  fingerprint: 'fp',
});

describe('testing an MCP server connection', { timeout: 15_000 }, () => {
  it('starts the server with its own env only and lists its tools', async () => {
    const marker = join(dir, 'started');
    const result = await probeMcpServer(stdio([ECHO, marker], { ECHO_TOKEN: 'from-keychain' }), {
      env: { PATH: process.env.PATH ?? '', SECRET_TOKEN: 'parent' },
    });
    expect(result).toEqual({ ok: true, tools: ['echo', 'shout'], error: null });
    expect((await readFile(marker, 'utf8')).trim()).toBe('from-keychain|');
  });

  it('reports a server that exits, with its stderr and secrets redacted', async () => {
    const result = await probeMcpServer(
      stdio(['-e', 'console.error("bad key sk-abcdefghijklmnopqrstuv"); process.exit(3)']),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('bad key');
    expect(result.error).not.toContain('sk-abcdefghijklmnopqrstuv');
  });

  it('stops waiting after the time limit', async () => {
    const result = await probeMcpServer(stdio(['-e', 'setInterval(() => {}, 1000)']), {
      timeoutMs: 800,
    });
    expect(result).toMatchObject({ ok: false, error: 'No answer within 1 s.' });
  });

  it('reports an HTTP server that cannot be reached', async () => {
    const result = await probeMcpServer({
      ...stdio([]),
      transport: 'http',
      command: null,
      url: 'http://127.0.0.1:9/mcp',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
