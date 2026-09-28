import type { ChatMcpVia, McpEnablement, UserMcpServer } from '@spark-outpost/contracts';
import { GLOBAL_KEY, type EnablementRow, type UserMcpRow } from './store.ts';

export interface Effective extends McpEnablement {
  via: ChatMcpVia;
}

export function enablementOf(server: UserMcpRow, row: EnablementRow): McpEnablement {
  const current = row.fingerprint === server.fingerprint;
  return { enabled: row.enabled && current, changed: row.enabled && !current };
}

export function effectiveFor(
  server: UserMcpRow,
  rows: readonly EnablementRow[],
  chatId: string | null,
  projectIds: readonly string[],
): Effective {
  const mine = rows.filter((row) => row.serverId === server.id);
  const find = (scope: EnablementRow['scope'], key: string) =>
    mine.find((row) => row.scope === scope && row.scopeKey === key);
  const candidates = [
    chatId ? find('chat', chatId) : undefined,
    ...projectIds.map((projectId) => find('project', projectId)),
    find('global', GLOBAL_KEY),
  ];
  const deciding = candidates.find((row) => row !== undefined);
  if (!deciding) return { enabled: false, changed: false, via: 'off' };
  return { ...enablementOf(server, deciding), via: deciding.scope };
}

export function userServerView(server: UserMcpRow, rows: readonly EnablementRow[]): UserMcpServer {
  const mine = rows.filter((row) => row.serverId === server.id);
  const global = mine.find((row) => row.scope === 'global');
  return {
    id: server.id,
    source: server.source,
    name: server.name,
    transport: server.transport,
    command: server.config.command,
    args: server.config.args,
    url: server.config.url,
    envNames: server.config.envNames,
    headerNames: server.config.headerNames,
    secretNames: server.config.secretNames,
    importableNames: server.config.importableNames.filter(
      (name) => !server.config.secretNames.includes(name),
    ),
    origin: server.config.origin,
    fingerprint: server.fingerprint,
    global: global ? enablementOf(server, global) : null,
    projects: mine
      .filter((row) => row.scope === 'project')
      .map((row) => ({ projectId: row.scopeKey, ...enablementOf(server, row) })),
    check: server.check,
  };
}
