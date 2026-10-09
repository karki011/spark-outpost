import path from 'node:path';
import {
  MCP_NAME_PATTERN,
  redactText,
  sensitiveFieldKind,
  type McpTransport,
} from '@spark-outpost/contracts';
import { SparkToolError } from '../tool.ts';

export interface McpConfigFields {
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  envNames: string[];
  headerNames: string[];
}

const SECRET_HELP =
  'Never pass secret values. Give the NAME of an environment variable (env) or header (headers); the user fills its value in Settings → MCP servers.';
const CONTROL_CHARACTER = /\p{Cc}/u;
const FLAG_WITH_VALUE = /^--?([A-Za-z][\w-]*)=(.+)$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/;

function refuseSecret(where: string): never {
  throw new SparkToolError(`The ${where} looks like it holds a secret. ${SECRET_HELP}`);
}

export function holdsSecret(text: string): boolean {
  if (redactText(text) !== text) return true;
  const named = FLAG_WITH_VALUE.exec(text) ?? ASSIGNMENT.exec(text);
  return Boolean(named && sensitiveFieldKind(named[1]!));
}

function assertNoSecret(where: string, text: string): void {
  if (holdsSecret(text)) refuseSecret(where);
}

export function hasSecretFlagPair(args: readonly string[]): boolean {
  return args.some((arg, index) => {
    const flag = /^--?([A-Za-z][\w-]*)$/.exec(arg);
    return Boolean(flag && sensitiveFieldKind(flag[1]!) && args[index + 1] !== undefined);
  });
}

function assertNoSecretFlagPairs(args: readonly string[]): void {
  if (hasSecretFlagPair(args)) refuseSecret('arguments');
}

function checkedCommand(command: string | null, args: readonly string[]): string {
  if (!command) throw new SparkToolError('A stdio server needs a command.');
  if (CONTROL_CHARACTER.test(command) || args.some((arg) => CONTROL_CHARACTER.test(arg))) {
    throw new SparkToolError('The command and its arguments must be plain single-line text.');
  }
  if (/\s/.test(command) && !path.isAbsolute(command)) {
    throw new SparkToolError(
      'Put only the program in command (for example "npx") and each argument in args.',
    );
  }
  assertNoSecret('command', command);
  for (const arg of args) assertNoSecret('arguments', arg);
  assertNoSecretFlagPairs(args);
  return command;
}

function checkedUrl(url: string | null): string {
  const parsed = url ? URL.parse(url) : null;
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    throw new SparkToolError('An HTTP or SSE server needs an http:// or https:// URL.');
  }
  if (parsed.username || parsed.password) refuseSecret('URL');
  assertNoSecret('URL', parsed.toString());
  for (const [key, value] of parsed.searchParams) {
    if (sensitiveFieldKind(key) && value) refuseSecret('URL');
  }
  return parsed.toString();
}

const unique = (names: readonly string[]) => [...new Set(names)];

export function checkedMcpConfig(fields: McpConfigFields): McpConfigFields {
  if (!MCP_NAME_PATTERN.test(fields.name)) {
    throw new SparkToolError('Name the server with letters, numbers, - and _ (up to 64).');
  }
  if (fields.transport === 'stdio') {
    return {
      name: fields.name,
      transport: 'stdio',
      command: checkedCommand(fields.command, fields.args),
      args: fields.args,
      url: null,
      envNames: unique(fields.envNames),
      headerNames: [],
    };
  }
  return {
    name: fields.name,
    transport: fields.transport,
    command: null,
    args: [],
    url: checkedUrl(fields.url),
    envNames: [],
    headerNames: unique(fields.headerNames),
  };
}

export function valueNames(config: McpConfigFields): string[] {
  return config.transport === 'stdio' ? config.envNames : config.headerNames;
}
