import { describe, expect, it } from 'vitest';
import { effectiveFor, userServerView } from './effective.ts';
import { GLOBAL_KEY, type EnablementRow, type UserMcpRow } from './store.ts';

const server: UserMcpRow = {
  id: '00000000-0000-4000-8000-000000000001',
  source: 'imported:cursor',
  name: 'github',
  transport: 'stdio',
  fingerprint: 'fp-now',
  check: null,
  config: {
    command: 'npx',
    args: ['gh-mcp'],
    url: null,
    envNames: ['GITHUB_TOKEN', 'LOG'],
    headerNames: [],
    secretNames: ['GITHUB_TOKEN'],
    importableNames: ['GITHUB_TOKEN', 'LOG'],
    origin: '/home/.cursor/mcp.json',
  },
};

const PROJECT = '00000000-0000-4000-8000-00000000000a';
const CHAT = '00000000-0000-4000-8000-00000000000c';

const row = (
  scope: EnablementRow['scope'],
  scopeKey: string,
  enabled: boolean,
  fingerprint = 'fp-now',
): EnablementRow => ({ serverId: server.id, scope, scopeKey, enabled, fingerprint });

describe('which scope decides whether a user-level server runs', () => {
  it('is off when nothing was turned on', () => {
    expect(effectiveFor(server, [], CHAT, [PROJECT])).toEqual({
      enabled: false,
      changed: false,
      via: 'off',
    });
  });

  it('prefers the chat, then the project, then the all-chats switch', () => {
    const rows = [row('global', GLOBAL_KEY, true), row('project', PROJECT, false)];
    expect(effectiveFor(server, rows, CHAT, [])).toMatchObject({ enabled: true, via: 'global' });
    expect(effectiveFor(server, rows, CHAT, [PROJECT])).toMatchObject({
      enabled: false,
      via: 'project',
    });
    const withChat = [...rows, row('chat', CHAT, true)];
    expect(effectiveFor(server, withChat, CHAT, [PROJECT])).toMatchObject({
      enabled: true,
      via: 'chat',
    });
    expect(effectiveFor(server, withChat, 'another-chat', [PROJECT]).enabled).toBe(false);
  });

  it('turns a server off when its config changed after the review', () => {
    const rows = [row('global', GLOBAL_KEY, true, 'fp-old')];
    expect(effectiveFor(server, rows, CHAT, [])).toEqual({
      enabled: false,
      changed: true,
      via: 'global',
    });
    const view = userServerView(server, [...rows, row('project', PROJECT, true, 'fp-old')]);
    expect(view.global).toEqual({ enabled: false, changed: true });
    expect(view.projects).toEqual([{ projectId: PROJECT, enabled: false, changed: true }]);
  });

  it('offers to copy only values that are not in the keychain yet', () => {
    expect(userServerView(server, []).importableNames).toEqual(['LOG']);
  });
});
