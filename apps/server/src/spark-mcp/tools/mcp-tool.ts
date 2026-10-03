import { z } from 'zod';
import { conversationProjectIds } from '../../agent-config/store.ts';
import { effectiveFor } from '../../mcp/effective.ts';
import {
  enablementsFor,
  listUserMcp,
  type EnablementRow,
  type UserMcpRow,
} from '../../mcp/store.ts';
import { listProjects } from '../../projects/projects.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const MCP_SETTINGS_PLACE = 'Settings → MCP servers';

export function matchMcpServer(servers: readonly UserMcpRow[], reference: string): UserMcpRow {
  const wanted = reference.trim().toLowerCase();
  const matches = servers.filter(
    (server) => server.id === wanted || server.name.toLowerCase() === wanted,
  );
  const found = matches.find((server) => server.source === 'user') ?? matches[0];
  if (found) return found;
  const names = servers.map((server) => server.name).join(', ') || 'none';
  throw new SparkToolError(`No MCP server called ${reference}. MCP servers: ${names}.`);
}

export function missingValues(server: UserMcpRow): string[] {
  const names = server.transport === 'stdio' ? server.config.envNames : server.config.headerNames;
  return names.filter((name) => !server.config.secretNames.includes(name));
}

export function onSomewhere(server: UserMcpRow, rows: readonly EnablementRow[]): boolean {
  return rows.some(
    (row) => row.serverId === server.id && row.enabled && row.fingerprint === server.fingerprint,
  );
}

interface Places {
  rows: readonly EnablementRow[];
  chatId: string | null;
  chatProjects: readonly string[];
  projectNames: ReadonlyMap<string, string>;
}

function describe(server: UserMcpRow, places: Places) {
  const mine = places.rows.filter((row) => row.serverId === server.id);
  const needsReview = mine.some((row) => row.enabled && row.fingerprint !== server.fingerprint);
  const { chatId } = places;
  return {
    id: server.id,
    name: server.name,
    addedBy: server.source === 'user' ? 'the user or Spark' : server.source,
    canUpdate: server.source === 'user',
    transport: server.transport,
    command: server.config.command,
    args: server.config.args,
    url: server.config.url,
    envNames: server.config.envNames,
    headerNames: server.config.headerNames,
    valuesMissing: missingValues(server),
    on: {
      allChats: effectiveFor(server, places.rows, null, []).enabled,
      ...(chatId
        ? { thisChat: effectiveFor(server, places.rows, chatId, places.chatProjects).enabled }
        : {}),
      projects: mine
        .filter((row) => row.scope === 'project')
        .map((row) => ({
          project: places.projectNames.get(row.scopeKey) ?? row.scopeKey,
          on: row.enabled && row.fingerprint === server.fingerprint,
        })),
    },
    needsReview,
    lastCheck: server.check
      ? {
          ok: server.check.ok,
          tools: server.check.tools,
          error: server.check.error,
          at: server.check.checkedAt,
          beforeLastChange: server.check.fingerprint !== server.fingerprint,
        }
      : null,
  };
}

async function mcpServers(context: SparkToolContext, args: { server?: string | undefined }) {
  const { deps, scope } = context;
  const servers = await listUserMcp(deps.db, scope.workspaceId);
  const [rows, projects, chatProjects] = await Promise.all([
    enablementsFor(
      deps.db,
      servers.map((server) => server.id),
    ),
    listProjects(deps.db, scope.workspaceId),
    scope.conversationId ? conversationProjectIds(deps.db, scope.conversationId) : [],
  ]);
  const places: Places = {
    rows,
    chatId: scope.conversationId,
    chatProjects,
    projectNames: new Map(projects.map((project) => [project.id, project.name])),
  };
  const shown = args.server ? [matchMcpServer(servers, args.server)] : servers;
  return {
    servers: shown.map((server) => describe(server, places)),
    note: `The user's own MCP servers from ${MCP_SETTINGS_PLACE}. Secret values are never shown: valuesMissing lists the environment variables or headers the user still has to fill there. needsReview means the server changed after it was turned on, so it stays off until reviewed. Add, change, switch or remove one with spark_add_mcp_server, spark_update_mcp_server, spark_switch_mcp_server and spark_remove_mcp_server. Servers a repo declares in .mcp.json are in spark_projects, not here.`,
  };
}

export const mcpServersTool = sparkTool({
  name: 'spark_mcp_servers',
  title: 'MCP servers',
  description:
    "List the user's MCP servers: name, where each came from, transport, the exact command and arguments or URL, the NAMES of its environment variables and headers (never values) and which still need a value, where it is on (all chats, this chat, projects), whether it changed since it was reviewed, and the last connection test. Pass server (name or id) for one. Use it to check whether a server already exists before adding one.",
  input: {
    server: z.string().trim().min(1).max(100).optional().describe('An MCP server name or id.'),
  },
  run: (args, context) => mcpServers(context, args),
});
