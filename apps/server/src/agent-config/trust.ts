import type { FolderTrust, TrustChange } from '@spark-outpost/contracts';
import { appliedAllowRules } from './allow-rules.ts';
import type { RepoScan } from './discovery.ts';
import { fingerprintOf } from './fingerprint.ts';
import type { McpServerConfig } from './mcp-json.ts';
import { isRecord } from './records.ts';
import { redirectSettingsOf, redirectsFingerprint, type RedirectSettings } from './redirects.ts';
import { hookPreview, type HooksConfig } from './settings-files.ts';

export interface ExecutableItem {
  kind: TrustChange['kind'];
  key: string;
  label: string;
  fingerprint: string;
}

export interface TrustRow {
  trusted: boolean;
  fingerprint: string | null;
  snapshot: ExecutableItem[];
  redirectsFingerprint: string | null;
  decidedAt: string;
}

export interface TrustedParts {
  hooks: HooksConfig | null;
  mcpServers: McpServerConfig[];
  allowRules: string[];
  redirects: RedirectSettings | null;
}

function hookItems(config: HooksConfig): ExecutableItem[] {
  const items: ExecutableItem[] = [];
  const seen = new Map<string, number>();
  for (const [event, entries] of Object.entries(config)) {
    for (const entry of entries) {
      const matcher = typeof entry.matcher === 'string' && entry.matcher ? entry.matcher : null;
      const hooks = Array.isArray(entry.hooks) ? entry.hooks.filter(isRecord) : [];
      for (const hook of hooks) {
        const label = `${event}${matcher ? ` (${matcher})` : ''}: ${hookPreview(hook) ?? 'hook'}`;
        const count = (seen.get(label) ?? 0) + 1;
        seen.set(label, count);
        items.push({
          kind: 'hook',
          key: count === 1 ? label : `${label} #${count}`,
          label,
          fingerprint: fingerprintOf([event, matcher, hook]),
        });
      }
    }
  }
  return items;
}

function mcpLabel(server: McpServerConfig): string {
  const target =
    server.transport === 'stdio'
      ? [server.command, ...server.args].join(' ')
      : `${server.transport.toUpperCase()} ${server.url}`;
  return `${server.name}: ${target}`;
}

export function executableItems(scan: RepoScan): ExecutableItem[] {
  const rules = [...new Set(scan.allowRules.map((entry) => entry.rule))];
  return [
    ...hookItems(scan.hooksConfig),
    ...rules.map((rule) => ({ kind: 'allow' as const, key: rule, label: rule, fingerprint: rule })),
    ...scan.mcpServers.map((server) => ({
      kind: 'mcp' as const,
      key: server.name,
      label: mcpLabel(server),
      fingerprint: server.fingerprint,
    })),
  ];
}

export function trustFingerprint(items: readonly ExecutableItem[]): string {
  return fingerprintOf(items.map((item) => [item.kind, item.key, item.fingerprint]));
}

function trustChanges(
  before: readonly ExecutableItem[],
  after: readonly ExecutableItem[],
): TrustChange[] {
  const id = (item: ExecutableItem) => `${item.kind}\u0000${item.key}`;
  const old = new Map(before.map((item) => [id(item), item]));
  const now = new Map(after.map((item) => [id(item), item]));
  const changes: TrustChange[] = [];
  for (const item of after) {
    const previous = old.get(id(item));
    if (!previous) changes.push({ change: 'added', kind: item.kind, label: item.label });
    else if (previous.fingerprint !== item.fingerprint) {
      changes.push({ change: 'changed', kind: item.kind, label: item.label });
    }
  }
  for (const item of before) {
    if (!now.has(id(item))) changes.push({ change: 'removed', kind: item.kind, label: item.label });
  }
  return changes;
}

function isTrusted(row: TrustRow | null, scan: RepoScan): boolean {
  return row !== null && row.trusted && row.fingerprint === trustFingerprint(executableItems(scan));
}

export function redirectsConfirmed(row: TrustRow | null, scan: RepoScan): boolean {
  const current = redirectsFingerprint(scan.redirects);
  return isTrusted(row, scan) && current !== null && row!.redirectsFingerprint === current;
}

export function folderTrust(scan: RepoScan, row: TrustRow | null): FolderTrust {
  const items = executableItems(scan);
  const fingerprint = trustFingerprint(items);
  const current = redirectsFingerprint(scan.redirects);
  const trusted = isTrusted(row, scan);
  const changed = row !== null && row.trusted && !trusted;
  const state = row === null ? 'unset' : trusted ? 'trusted' : changed ? 'changed' : 'not_trusted';
  let redirects: FolderTrust['redirects'] = 'none';
  if (current !== null) {
    if (redirectsConfirmed(row, scan)) redirects = 'on';
    else if (row?.redirectsFingerprint) redirects = 'changed';
    else redirects = 'off';
  }
  return {
    needed: items.length > 0 || current !== null,
    state,
    fingerprint,
    decidedAt: row?.decidedAt ?? null,
    changes: changed ? trustChanges(row.snapshot, items) : [],
    redirects,
    redirectsFingerprint: current,
  };
}

export function trustedParts(scan: RepoScan, row: TrustRow | null): TrustedParts | null {
  if (!isTrusted(row, scan)) return null;
  const hasHooks = Object.keys(scan.hooksConfig).length > 0;
  return {
    hooks: hasHooks ? scan.hooksConfig : null,
    mcpServers: scan.mcpServers,
    allowRules: appliedAllowRules(scan.allowRules.map((entry) => entry.rule)),
    redirects: redirectsConfirmed(row, scan) ? redirectSettingsOf(scan.redirects) : null,
  };
}
