import { createHash } from 'node:crypto';
import type { McpTransport } from '@spark-outpost/contracts';

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function transportOf(entry: Record<string, unknown>): McpTransport | null {
  if (entry.type === 'http' || entry.type === 'sse' || entry.type === 'stdio') return entry.type;
  if (typeof entry.command === 'string') return 'stdio';
  if (typeof entry.url === 'string') return 'http';
  return null;
}

export function mcpFingerprint(config: Omit<McpServerConfig, 'fingerprint'>): string {
  const canonical = JSON.stringify([
    config.name,
    config.transport,
    config.command,
    config.args,
    config.url,
    Object.entries(config.env).sort(),
    Object.entries(config.headers).sort(),
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

function mcpServerFrom(name: string, entry: unknown): McpServerConfig | string {
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

export function referencedNames(config: McpServerConfig): string[] {
  const texts = [
    config.command ?? '',
    config.url ?? '',
    ...config.args,
    ...Object.values(config.env),
    ...Object.values(config.headers),
  ];
  const names = texts.flatMap((text) => [...text.matchAll(REFERENCE)].map((match) => match[1]!));
  return [...new Set(names)].sort();
}

export function expandReferences(text: string, env: Readonly<Record<string, string>>): string {
  return text.replace(REFERENCE, (_whole, name: string, fallback: string | undefined) => {
    return env[name] ?? fallback ?? '';
  });
}
