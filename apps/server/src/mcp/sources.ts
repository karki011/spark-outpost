import { basename, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { McpImportTool } from '@spark-outpost/contracts';
import { isRecord, mcpServerFrom, type McpServerConfig } from '../agent-config/mcp-json.ts';
import { parseJsonc } from './jsonc.ts';

export interface ParsedServers {
  servers: McpServerConfig[];
  warnings: string[];
}

export interface ImportSource {
  tool: McpImportTool;
  label: string;
  path: string;
  parse: (text: string) => ParsedServers;
}

type Entries = [name: string, entry: unknown][];

function collect(entries: Entries, label: string): ParsedServers {
  const parsed: ParsedServers = { servers: [], warnings: [] };
  const taken = new Set<string>();
  for (const [name, entry] of entries) {
    const result = mcpServerFrom(name, entry);
    if (typeof result === 'string') parsed.warnings.push(`${label}: ${result}`);
    else if (taken.has(result.name)) {
      parsed.warnings.push(`${label}: a second MCP server named "${name}" was skipped.`);
    } else {
      taken.add(result.name);
      parsed.servers.push(result);
    }
  }
  return parsed;
}

function unreadable(label: string, format: string): ParsedServers {
  return { servers: [], warnings: [`${label} is not valid ${format}, so it was skipped.`] };
}

function objectEntries(value: unknown): Entries {
  return isRecord(value) ? Object.entries(value) : [];
}

function jsonSource(label: string, read: (parsed: unknown) => Entries, jsonc = false) {
  return (text: string): ParsedServers => {
    let parsed: unknown;
    try {
      parsed = jsonc ? parseJsonc(text) : JSON.parse(text);
    } catch {
      return unreadable(label, 'JSON');
    }
    return collect(read(parsed), label);
  };
}

function claudeCodeEntries(parsed: unknown): Entries {
  if (!isRecord(parsed)) return [];
  const global = objectEntries(parsed.mcpServers);
  const names = new Set(global.map(([name]) => name));
  const perProject: Entries = [];
  for (const [path, project] of objectEntries(parsed.projects)) {
    if (!isRecord(project)) continue;
    for (const [name, entry] of objectEntries(project.mcpServers)) {
      const unique = names.has(name) ? `${name}-${basename(path)}` : name;
      names.add(unique);
      perProject.push([unique, entry]);
    }
  }
  return [...global, ...perProject];
}

function windsurfEntries(parsed: unknown): Entries {
  if (!isRecord(parsed)) return [];
  return objectEntries(parsed.mcpServers).map(([name, entry]) => {
    if (!isRecord(entry) || typeof entry.serverUrl !== 'string' || 'url' in entry) {
      return [name, entry];
    }
    return [name, { ...entry, url: entry.serverUrl }];
  });
}

function vscodeSettingsEntries(parsed: unknown): Entries {
  if (!isRecord(parsed)) return [];
  const nested = isRecord(parsed.mcp) ? parsed.mcp.servers : undefined;
  return [...objectEntries(nested), ...objectEntries(parsed['mcp.servers'])];
}

function stringTable(value: unknown): Record<string, string> {
  return Object.fromEntries(
    objectEntries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

export function codexEntry(entry: unknown): unknown {
  if (!isRecord(entry)) return entry;
  const headers: Record<string, string> = { ...stringTable(entry.http_headers) };
  for (const [header, variable] of Object.entries(stringTable(entry.env_http_headers))) {
    headers[header] = `\${${variable}}`;
  }
  if (typeof entry.bearer_token_env_var === 'string') {
    headers.Authorization = `Bearer \${${entry.bearer_token_env_var}}`;
  }
  return {
    ...(typeof entry.command === 'string' ? { command: entry.command } : {}),
    ...(typeof entry.url === 'string' ? { type: 'http', url: entry.url } : {}),
    args: entry.args,
    env: entry.env,
    headers,
  };
}

export function codexServerTable(text: string): Record<string, unknown> | null {
  try {
    const parsed = parseToml(text);
    return isRecord(parsed.mcp_servers) ? parsed.mcp_servers : {};
  } catch {
    return null;
  }
}

function codexSource(label: string) {
  return (text: string): ParsedServers => {
    const table = codexServerTable(text);
    if (!table) return unreadable(label, 'TOML');
    return collect(
      Object.entries(table).map(([name, entry]) => [name, codexEntry(entry)]),
      label,
    );
  };
}

export interface SourceHomes {
  home: string;
  codexHome: string;
}

export function importSources({ home, codexHome }: SourceHomes): ImportSource[] {
  const support = join(home, 'Library', 'Application Support');
  const vscodeUser = join(support, 'Code', 'User');
  const source = (
    tool: McpImportTool,
    label: string,
    path: string,
    parse: ImportSource['parse'],
  ): ImportSource => ({ tool, label, path, parse });
  return [
    source(
      'claude-code',
      'Claude Code',
      join(home, '.claude.json'),
      jsonSource('~/.claude.json', claudeCodeEntries),
    ),
    source(
      'claude-desktop',
      'Claude Desktop',
      join(support, 'Claude', 'claude_desktop_config.json'),
      jsonSource('claude_desktop_config.json', (parsed) =>
        objectEntries(isRecord(parsed) ? parsed.mcpServers : undefined),
      ),
    ),
    source(
      'cursor',
      'Cursor',
      join(home, '.cursor', 'mcp.json'),
      jsonSource('~/.cursor/mcp.json', (parsed) =>
        objectEntries(isRecord(parsed) ? parsed.mcpServers : undefined),
      ),
    ),
    source(
      'vscode',
      'VS Code',
      join(vscodeUser, 'mcp.json'),
      jsonSource(
        'VS Code mcp.json',
        (parsed) => objectEntries(isRecord(parsed) ? parsed.servers : undefined),
        true,
      ),
    ),
    source(
      'vscode',
      'VS Code settings',
      join(vscodeUser, 'settings.json'),
      jsonSource('VS Code settings.json', vscodeSettingsEntries, true),
    ),
    source('codex', 'Codex', join(codexHome, 'config.toml'), codexSource('Codex config.toml')),
    source(
      'windsurf',
      'Windsurf',
      join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      jsonSource('Windsurf mcp_config.json', windsurfEntries),
    ),
  ];
}
