import { describe, expect, it } from 'vitest';
import type { McpScanSource, UserMcpServer } from '@spark-outpost/contracts';
import { scanLine, scopeLine, statusOf } from './mcp-labels.ts';

const PROJECT = '00000000-0000-4000-8000-000000000001';

function server(change: Partial<UserMcpServer> = {}): UserMcpServer {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    source: 'user',
    name: 'echo',
    transport: 'stdio',
    command: 'node',
    args: [],
    url: null,
    envNames: [],
    headerNames: [],
    secretNames: [],
    importableNames: [],
    origin: null,
    fingerprint: 'f1',
    global: null,
    projects: [],
    check: null,
    ...change,
  };
}

const check = { ok: true, fingerprint: 'f1', tools: ['echo'], error: null, checkedAt: '' };
const enabled = { enabled: true, changed: false };

describe('statusOf', () => {
  it('names the latest test result for the current config', () => {
    expect(statusOf(server()).text).toBe('Not tested');
    expect(statusOf(server({ check })).text).toBe('Works');
    expect(statusOf(server({ check: { ...check, ok: false } })).text).toBe('Failing');
    expect(statusOf(server({ check: { ...check, fingerprint: 'old' } })).text).toBe('Test again');
  });

  it('puts a changed config first', () => {
    const changed = server({ check, global: { enabled: false, changed: true } });
    expect(statusOf(changed)).toEqual({ tone: 'warn', text: 'Changed' });
  });
});

describe('scopeLine', () => {
  it('summarises where the server is on', () => {
    expect(scopeLine(server())).toBe('Off');
    expect(scopeLine(server({ global: enabled }))).toBe('All chats');
    expect(scopeLine(server({ projects: [{ ...enabled, projectId: PROJECT }] }))).toBe('1 project');
    expect(
      scopeLine(
        server({ global: enabled, projects: [{ ...enabled, enabled: false, projectId: PROJECT }] }),
      ),
    ).toBe('All chats · off in 1 project');
  });
});

describe('scanLine', () => {
  const source = (label: string, servers: number): McpScanSource => ({
    tool: 'cursor',
    label,
    path: `/x/${label}`,
    found: servers > 0,
    servers,
    warnings: [],
  });

  it('counts the apps and names where servers were found', () => {
    expect(scanLine([source('Codex', 2), source('Cursor', 1), source('VS Code', 0)])).toBe(
      'Scanned 3 apps · found 3 servers in Codex and Cursor',
    );
    expect(scanLine([source('Codex', 0)])).toBe('Scanned 1 app · no MCP servers found');
  });
});
