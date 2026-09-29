import type {
  McpCheck,
  McpScanSource,
  McpServerSource,
  McpTransport,
  UserMcpServer,
} from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';
import { joinCommandLine } from './mcp-command-line.ts';

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
  codex: 'Codex',
  windsurf: 'Windsurf',
};

export const SCAN_APPS = Object.values(TOOL_LABELS);

export function sourceLabel(source: McpServerSource): string {
  if (source === 'user') return 'Added by you';
  if (source === 'project') return 'From the repo';
  const tool = source.replace(/^imported:/, '');
  return `From ${TOOL_LABELS[tool] ?? tool}`;
}

export function targetLine(server: {
  transport: McpTransport;
  command: string | null;
  args: readonly string[];
  url: string | null;
}): string {
  if (server.transport === 'stdio') return joinCommandLine([server.command ?? '', ...server.args]);
  return server.url ?? '';
}

export function checkLine(check: McpCheck | null, fingerprint: string): string {
  if (!check) return 'Not tested yet';
  const stale = check.fingerprint !== fingerprint ? ' (before the last change)' : '';
  if (!check.ok) return `Failed${stale}`;
  const count = check.tools.length;
  return `Connected · ${countLabel(count, 'tool')}${stale}`;
}

export type StatusTone = 'ok' | 'bad' | 'warn' | 'none';

export function statusOf(server: UserMcpServer): { tone: StatusTone; text: string } {
  const changed = server.global?.changed || server.projects.some((row) => row.changed);
  if (changed) return { tone: 'warn', text: 'Changed' };
  const { check } = server;
  if (!check) return { tone: 'none', text: 'Not tested' };
  if (check.fingerprint !== server.fingerprint) return { tone: 'none', text: 'Test again' };
  return check.ok ? { tone: 'ok', text: 'Works' } : { tone: 'bad', text: 'Failing' };
}

export function scopeLine(server: UserMcpServer): string {
  const globalOn = server.global?.enabled ?? false;
  const differing = server.projects.filter((row) => row.enabled !== globalOn).length;
  if (globalOn)
    return differing ? `All chats · off in ${countLabel(differing, 'project')}` : 'All chats';
  return differing ? countLabel(differing, 'project') : 'Off';
}

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });

export function scanLine(sources: readonly McpScanSource[]): string {
  const withServers = sources.filter((source) => source.servers > 0);
  const total = withServers.reduce((sum, source) => sum + source.servers, 0);
  const scanned = `Scanned ${countLabel(sources.length, 'app')}`;
  if (total === 0) return `${scanned} · no MCP servers found`;
  const where = listFormat.format(withServers.map((source) => source.label));
  return `${scanned} · found ${countLabel(total, 'server')} in ${where}`;
}

export function scanFound(sources: readonly McpScanSource[]): boolean {
  return sources.some((source) => source.servers > 0);
}
