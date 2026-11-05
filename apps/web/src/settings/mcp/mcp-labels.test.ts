import { describe, expect, it } from 'vitest';
import type { UserMcpServer } from '@spark-outpost/contracts';
import { scopeLine, statusOf } from './mcp-labels.ts';

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
