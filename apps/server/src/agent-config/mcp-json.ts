import type { McpTransport } from '@spark-outpost/contracts';
import { fingerprintOf } from './fingerprint.ts';
import { isRecord, stringMap } from './records.ts';

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
  fingerprint: string;
}

export interface McpJsonSummary {
  servers: McpServerConfig[];
  warnings: string[];
}

function transportOf(entry: Record<string, unknown>): McpTransport | null {
  if (entry.type === 'http' || entry.type === 'sse' || entry.type === 'stdio') return entry.type;
  if (typeof entry.command === 'string') return 'stdio';
  if (typeof entry.url === 'string') return 'http';
  return null;
}

export function mcpFingerprint(config: Omit<McpServerConfig, 'fingerprint'>): string {
  return fingerprintOf([
    config.name,
    config.transport,
    config.command,
    config.args,
    config.url,
    Object.entries(config.env).sort(),
    Object.entries(config.headers).sort(),
  ]);
}

export function storedMcpConfig(server: Omit<McpServerConfig, 'fingerprint'>) {
  return {
    command: server.command,
    args: server.args,
    url: server.url,
    envNames: Object.keys(server.env).sort(),
    headerNames: Object.keys(server.headers).sort(),
  };
}

export function mcpServerFrom(name: string, entry: unknown): McpServerConfig | string {
  if (!isRecord(entry)) return `MCP server "${name}" is not an object, so it was skipped.`;
  const transport = transportOf(entry);
  if (!transport) return `MCP server "${name}" has no command or URL, so it was skipped.`;
  const stdio = transport === 'stdio';
  const command = stdio && typeof entry.command === 'string' ? entry.command : null;
  const url = !stdio && typeof entry.url === 'string' ? entry.url : null;
  if (stdio ? !command : !url) {
    return `MCP server "${name}" is missing its ${stdio ? 'command' : 'URL'}, so it was skipped.`;
  }
  const config = {
    name,
    transport,
    command,
    args: Array.isArray(entry.args)
      ? entry.args.filter((arg): arg is string => typeof arg === 'string')
      : [],
    url,
    env: stringMap(entry.env),
    headers: stringMap(entry.headers),
  };
  return { ...config, fingerprint: mcpFingerprint(config) };
}

export function readMcpJson(text: string, source: string): McpJsonSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { servers: [], warnings: [`${source} is not valid JSON, so it was skipped.`] };
  }
  const servers = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : {};
  const summary: McpJsonSummary = { servers: [], warnings: [] };
  for (const [name, entry] of Object.entries(servers)) {
    const result = mcpServerFrom(name, entry);
    if (typeof result === 'string') summary.warnings.push(result);
    else summary.servers.push(result);
  }
  return summary;
}

const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function expandReferences(text: string, env: Readonly<Record<string, string>>): string {
  return text.replace(REFERENCE, (_whole, name: string, fallback: string | undefined) => {
    return env[name] ?? fallback ?? '';
  });
}
