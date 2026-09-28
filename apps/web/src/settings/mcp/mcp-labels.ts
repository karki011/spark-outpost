import type { McpCheck, McpServerSource, McpTransport } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';

const TOOL_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  cursor: 'Cursor',
  vscode: 'VS Code',
  codex: 'Codex',
  windsurf: 'Windsurf',
};

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
  if (server.transport === 'stdio') return [server.command ?? '', ...server.args].join(' ');
  return `${server.transport.toUpperCase()} ${server.url ?? ''}`;
}

export function checkLine(check: McpCheck | null, fingerprint: string): string {
  if (!check) return 'Not tested yet';
  const stale = check.fingerprint !== fingerprint ? ' (before the last change)' : '';
  if (!check.ok) return `Failed${stale}`;
  const count = check.tools.length;
  return `Connected · ${countLabel(count, 'tool')}${stale}`;
}
