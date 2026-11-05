import {
  MCP_NEW_SESSIONS_NOTE,
  saveUserMcpRequestSchema,
  type McpServerAction,
} from '@spark-outpost/contracts';
import { audit } from '../../agent-config/store.ts';
import { saveManualServer } from '../../mcp/save.ts';
import { deleteMcpSecrets } from '../../mcp/secrets.ts';
import {
  GLOBAL_KEY,
  deleteUserMcp,
  getUserMcp,
  keepEnabledAfterChange,
  setUserEnablement,
  type EnablementChange,
  type UserMcpRow,
} from '../../mcp/store.ts';
import type { SparkToolContext } from '../tool.ts';
import { MCP_SETTINGS_PLACE, missingValues } from '../tools/mcp-tool.ts';
import type { Performed } from './performed.ts';

type ActionOf<Name extends McpServerAction['action']> = Extract<McpServerAction, { action: Name }>;

const blanks = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, '']));

function saveBody(action: ActionOf<'add_mcp_server' | 'update_mcp_server'>) {
  return saveUserMcpRequestSchema.parse({
    name: action.name,
    transport: action.transport,
    command: action.command,
    args: action.args,
    url: action.url,
    env: blanks(action.envNames),
    headers: blanks(action.headerNames),
  });
}

async function saved(context: SparkToolContext, id: string): Promise<UserMcpRow> {
  const server = await getUserMcp(context.deps.db, context.scope.workspaceId, id);
  if (!server) throw new Error('That MCP server no longer exists.');
  return server;
}

function record(context: SparkToolContext, change: string, server: UserMcpRow): Promise<void> {
  return audit(
    context.deps.db,
    context.scope.workspaceId,
    null,
    'mcp',
    change !== 'removed',
    server.name,
    {
      change,
      by: 'agent',
      runId: context.scope.runId,
      source: server.source,
      transport: server.transport,
      fingerprint: server.fingerprint,
      command: server.config.command,
      args: server.config.args,
      url: server.config.url,
      envNames: server.config.envNames,
      headerNames: server.config.headerNames,
    },
  );
}

function target(server: UserMcpRow): string {
  const { command, args, url } = server.config;
  return server.transport === 'stdio' ? [command ?? '', ...args].join(' ') : (url ?? '');
}

function valuesLine(needs: readonly string[]): string {
  if (needs.length === 0) return '';
  return ` Fill ${needs.join(', ')} in ${MCP_SETTINGS_PLACE}, then turn it on there.`;
}

function facts(server: UserMcpRow) {
  const needsValues = missingValues(server);
  return {
    id: server.id,
    name: server.name,
    needsValues,
    ...(needsValues.length > 0 ? { fillValuesIn: MCP_SETTINGS_PLACE } : {}),
    note: MCP_NEW_SESSIONS_NOTE,
  };
}

function chatChange(context: SparkToolContext): EnablementChange {
  const chatId = context.scope.conversationId;
  if (!chatId) throw new Error('There is no chat to switch the server for.');
  return { scope: 'chat', scopeKey: chatId, enabled: true };
}

const ALL_CHATS: EnablementChange = { scope: 'global', scopeKey: GLOBAL_KEY, enabled: true };

export async function performAddMcpServer(
  context: SparkToolContext,
  action: ActionOf<'add_mcp_server'>,
): Promise<Performed> {
  const { db, secrets } = context.deps;
  const { workspaceId } = context.scope;
  const id = await saveManualServer({ db, workspaceId, secrets }, null, saveBody(action));
  const server = await saved(context, id);
  await record(context, 'added', server);
  const needs = missingValues(server);
  const turnOn = needs.length > 0 ? 'off' : action.turnOn;
  if (turnOn !== 'off') {
    const change = turnOn === 'all_chats' ? ALL_CHATS : chatChange(context);
    await setUserEnablement(db, workspaceId, server, change);
  }
  const where = { all_chats: ' It is on for all chats.', this_chat: ' It is on for this chat.' };
  return {
    message: `Added the MCP server ${server.name} (${target(server)}).${turnOn === 'off' ? ' It is off.' : where[turnOn]}${valuesLine(needs)}`,
    url: null,
    output: { ...facts(server), turnedOn: turnOn },
  };
}

export async function performUpdateMcpServer(
  context: SparkToolContext,
  action: ActionOf<'update_mcp_server'>,
): Promise<Performed> {
  const { db, secrets } = context.deps;
  const { workspaceId } = context.scope;
  const before = await saved(context, action.serverId);
  if (before.source !== 'user')
    throw new Error('Servers imported from another app cannot be edited.');
  await saveManualServer({ db, workspaceId, secrets }, before, saveBody(action));
  const server = await saved(context, action.serverId);
  await keepEnabledAfterChange(db, server.id, before.fingerprint, server.fingerprint);
  await record(context, 'updated', server);
  return {
    message: `Saved the MCP server ${server.name} (${target(server)}).${valuesLine(missingValues(server))}`,
    url: null,
    output: { ...facts(server), changed: action.changed },
  };
}

export async function performSwitchMcpServer(
  context: SparkToolContext,
  action: ActionOf<'switch_mcp_server'>,
): Promise<Performed> {
  const { db } = context.deps;
  const server = await saved(context, action.serverId);
  if (action.state === 'on' && server.fingerprint !== action.fingerprint) {
    throw new Error(`${server.name} changed after this was asked. Ask again to review it.`);
  }
  const enabled = action.state === 'inherit' ? null : action.state === 'on';
  const change: EnablementChange =
    action.place === 'all_chats'
      ? { ...ALL_CHATS, enabled }
      : action.place === 'project'
        ? { scope: 'project', scopeKey: action.project!.id, enabled }
        : { ...chatChange(context), enabled };
  await setUserEnablement(db, context.scope.workspaceId, server, change);
  const place =
    action.place === 'all_chats'
      ? 'all chats'
      : action.place === 'project'
        ? `the project ${action.project!.name}`
        : 'this chat';
  const did =
    action.state === 'inherit'
      ? `Cleared the setting of ${server.name} for ${place}.`
      : `Turned ${server.name} ${action.state} for ${place}.`;
  return {
    message: did,
    url: null,
    output: { id: server.id, name: server.name, state: action.state, note: MCP_NEW_SESSIONS_NOTE },
  };
}

export async function performRemoveMcpServer(
  context: SparkToolContext,
  action: ActionOf<'remove_mcp_server'>,
): Promise<Performed> {
  const { db, secrets } = context.deps;
  const server = await saved(context, action.serverId);
  await deleteUserMcp(db, context.scope.workspaceId, server.id);
  await deleteMcpSecrets(secrets, server.id);
  await record(context, 'removed', server);
  return {
    message: `Removed the MCP server ${server.name}.`,
    url: null,
    output: { name: server.name, note: MCP_NEW_SESSIONS_NOTE },
  };
}
