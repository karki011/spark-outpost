import { z } from 'zod';
import {
  MCP_ENV_NAME_PATTERN,
  MCP_HEADER_NAME_PATTERN,
  MCP_NAME_PATTERN,
  MCP_NEW_SESSIONS_NOTE,
  MCP_VALUE_NAMES_MAX,
  mcpSwitchPlaceSchema,
  mcpSwitchStateSchema,
  mcpTransportSchema,
  type SparkAction,
} from '@spark-outpost/contracts';
import { enablementsFor, listUserMcp, type UserMcpRow } from '../../mcp/store.ts';
import { listProjects } from '../../projects/projects.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import {
  MCP_SETTINGS_PLACE,
  matchMcpServer,
  missingValues,
  onSomewhere,
} from '../tools/mcp-tool.ts';
import { ACTION_NOTE } from './action-note.ts';
import { proposeAction } from './confirm.ts';
import { checkedMcpConfig, valueNames, type McpConfigFields } from './mcp-config.ts';

const SECRETS_NOTE = `Secret values never go through this tool: pass only the NAMES of environment variables (env) or headers (headers), and the user fills each value in ${MCP_SETTINGS_PLACE}. ${MCP_NEW_SESSIONS_NOTE}`;

const names = (pattern: RegExp, what: string) =>
  z
    .array(z.string().regex(pattern, `Pass ${what} names only, never NAME=value.`))
    .max(MCP_VALUE_NAMES_MAX);

const configInput = {
  command: z
    .string()
    .trim()
    .min(1)
    .max(1024)
    .optional()
    .describe('stdio: the program to run, such as "npx". Arguments go in args.'),
  args: z.array(z.string().max(4096)).max(64).optional().describe('stdio: one entry per argument.'),
  url: z.string().trim().max(2048).optional().describe('http or sse: the server URL.'),
  env: names(MCP_ENV_NAME_PATTERN, 'environment variable')
    .optional()
    .describe('stdio: NAMES of environment variables the server needs. Never values.'),
  headers: names(MCP_HEADER_NAME_PATTERN, 'header')
    .optional()
    .describe('http or sse: NAMES of request headers the server needs. Never values.'),
};

const nameInput = z
  .string()
  .regex(MCP_NAME_PATTERN, 'Use letters, numbers, - and _ (up to 64).')
  .describe('Short name for the server: letters, numbers, - and _.');

const serverRef = z.string().trim().min(1).max(100).describe('The MCP server: name or id.');

type ConfigArgs = z.output<z.ZodObject<typeof configInput>>;

async function userServers(context: SparkToolContext): Promise<UserMcpRow[]> {
  return listUserMcp(context.deps.db, context.scope.workspaceId);
}

function configOf(server: UserMcpRow): McpConfigFields {
  return {
    name: server.name,
    transport: server.transport,
    command: server.config.command,
    args: server.config.args,
    url: server.config.url,
    envNames: server.config.envNames,
    headerNames: server.config.headerNames,
  };
}

function shown(server: UserMcpRow) {
  return { serverId: server.id, ...configOf(server), needsValues: missingValues(server) };
}

function assertNameFree(servers: readonly UserMcpRow[], name: string, except?: string): void {
  const taken = servers.some(
    (server) => server.source === 'user' && server.name === name && server.id !== except,
  );
  if (taken) {
    throw new SparkToolError(
      `There is already an MCP server named ${name}. Change it with spark_update_mcp_server.`,
    );
  }
}

type TurnOn = 'all_chats' | 'this_chat' | 'off';

function turnOnFor(context: SparkToolContext, asked: TurnOn | undefined, needs: string[]): TurnOn {
  if (needs.length > 0) return 'off';
  const wanted = asked ?? (context.scope.conversationId ? 'this_chat' : 'off');
  if (wanted === 'this_chat' && !context.scope.conversationId) {
    throw new SparkToolError('There is no chat here to turn the server on for.');
  }
  return wanted;
}

async function add(
  context: SparkToolContext,
  args: ConfigArgs & {
    name: string;
    transport: McpConfigFields['transport'];
    turnOn?: TurnOn | undefined;
  },
) {
  const config = checkedMcpConfig({
    name: args.name,
    transport: args.transport,
    command: args.command ?? null,
    args: args.args ?? [],
    url: args.url ?? null,
    envNames: args.env ?? [],
    headerNames: args.headers ?? [],
  });
  assertNameFree(await userServers(context), config.name);
  const needsValues = valueNames(config);
  const action: SparkAction = {
    action: 'add_mcp_server',
    ...config,
    needsValues,
    turnOn: turnOnFor(context, args.turnOn, needsValues),
  };
  return proposeAction(context, action);
}

const CONFIG_FIELDS = [
  'name',
  'transport',
  'command',
  'args',
  'url',
  'envNames',
  'headerNames',
] as const;

async function update(
  context: SparkToolContext,
  args: ConfigArgs & {
    server: string;
    name?: string | undefined;
    transport?: McpConfigFields['transport'] | undefined;
  },
) {
  const servers = await userServers(context);
  const current = matchMcpServer(servers, args.server);
  if (current.source !== 'user') {
    throw new SparkToolError(
      `${current.name} was imported from another app and cannot be edited. Remove it and add it again.`,
    );
  }
  const before = configOf(current);
  const next = checkedMcpConfig({
    name: args.name ?? before.name,
    transport: args.transport ?? before.transport,
    command: args.command ?? before.command,
    args: args.args ?? before.args,
    url: args.url ?? before.url,
    envNames: args.env ?? before.envNames,
    headerNames: args.headers ?? before.headerNames,
  });
  const changed = CONFIG_FIELDS.filter(
    (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]),
  );
  if (changed.length === 0) throw new SparkToolError('Nothing would change.');
  assertNameFree(servers, next.name, current.id);
  const rows = await enablementsFor(context.deps.db, [current.id]);
  const action: SparkAction = {
    action: 'update_mcp_server',
    serverId: current.id,
    ...next,
    needsValues: valueNames(next).filter((name) => !current.config.secretNames.includes(name)),
    changed,
    keepsOn: onSomewhere(current, rows),
  };
  return proposeAction(context, action);
}

async function projectFor(context: SparkToolContext, reference: string | undefined) {
  if (!reference) throw new SparkToolError('Say which project: pass project (name or id).');
  const projects = await listProjects(context.deps.db, context.scope.workspaceId);
  const wanted = reference.toLowerCase();
  const found = projects.find(
    (project) => project.id === wanted || project.name.toLowerCase() === wanted,
  );
  if (!found) throw new SparkToolError(`No project called ${reference}.`);
  return { id: found.id, name: found.name };
}

async function switchServer(
  context: SparkToolContext,
  args: {
    server: string;
    state: z.infer<typeof mcpSwitchStateSchema>;
    place: z.infer<typeof mcpSwitchPlaceSchema>;
    project?: string | undefined;
  },
) {
  const server = matchMcpServer(await userServers(context), args.server);
  if (args.place === 'this_chat' && !context.scope.conversationId) {
    throw new SparkToolError('There is no chat here to switch the server for.');
  }
  const needs = missingValues(server);
  if (args.state === 'on' && needs.length > 0) {
    throw new SparkToolError(
      `${server.name} still needs a value for ${needs.join(', ')}. Ask the user to fill it in ${MCP_SETTINGS_PLACE} first.`,
    );
  }
  const action: SparkAction = {
    action: 'switch_mcp_server',
    ...shown(server),
    fingerprint: server.fingerprint,
    place: args.place,
    project: args.place === 'project' ? await projectFor(context, args.project) : null,
    state: args.state,
  };
  return proposeAction(context, action);
}

async function remove(context: SparkToolContext, args: { server: string }) {
  const server = matchMcpServer(await userServers(context), args.server);
  return proposeAction(context, { action: 'remove_mcp_server', ...shown(server) });
}

export const mcpActionTools = [
  sparkTool({
    name: 'spark_add_mcp_server',
    title: 'Add an MCP server',
    acts: true,
    description:
      `Propose a new MCP server in ${MCP_SETTINGS_PLACE}: a stdio server (command and args, which run on the user's computer) or an http or sse server (url). Check spark_mcp_servers first so you don't add one twice. The card shows the exact command and arguments. With no values to fill, it is turned on for this chat unless turnOn says otherwise; a server that needs values stays off until the user fills them. ${SECRETS_NOTE} ` +
      ACTION_NOTE,
    input: {
      name: nameInput,
      transport: mcpTransportSchema.describe('stdio (a local command), http or sse.'),
      ...configInput,
      turnOn: z
        .enum(['all_chats', 'this_chat', 'off'])
        .optional()
        .describe('Where to turn it on once added. Default: this_chat.'),
    },
    run: (args, context) => add(context, args),
  }),
  sparkTool({
    name: 'spark_update_mcp_server',
    title: 'Change an MCP server',
    acts: true,
    description:
      `Propose changes to an MCP server the user added (pass server: its name or id): rename it or change its transport, command, args, url, or the names of its environment variables or headers. Only the fields you pass change; a name you keep keeps its saved value, a name you drop loses it. It stays on where it is on now. Servers imported from another app cannot be edited. ${SECRETS_NOTE} ` +
      ACTION_NOTE,
    input: {
      server: serverRef,
      name: nameInput.optional().describe('A new name.'),
      transport: mcpTransportSchema.optional(),
      ...configInput,
    },
    run: (args, context) => update(context, args),
  }),
  sparkTool({
    name: 'spark_switch_mcp_server',
    title: 'Turn an MCP server on or off',
    acts: true,
    description:
      `Propose turning an MCP server on or off for all chats, this chat or one project (pass project). state inherit clears the chat's or project's own setting so it follows the wider one. A server that still needs values cannot be turned on. ${MCP_NEW_SESSIONS_NOTE} ` +
      ACTION_NOTE,
    input: {
      server: serverRef,
      state: mcpSwitchStateSchema.describe('on, off, or inherit (clear this place’s own setting).'),
      place: mcpSwitchPlaceSchema.default('this_chat').describe('all_chats, this_chat or project.'),
      project: z.string().trim().min(1).max(200).optional().describe('For place project.'),
    },
    run: (args, context) => switchServer(context, args),
  }),
  sparkTool({
    name: 'spark_remove_mcp_server',
    title: 'Remove an MCP server',
    acts: true,
    description:
      `Propose removing an MCP server from ${MCP_SETTINGS_PLACE}, with its saved values and every place it is turned on. ${MCP_NEW_SESSIONS_NOTE} ` +
      ACTION_NOTE,
    input: { server: serverRef },
    run: (args, context) => remove(context, args),
  }),
];
