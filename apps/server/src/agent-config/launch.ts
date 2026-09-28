import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Queryable } from '../persistence/db.ts';
import type { RepoScan, RepoScanner, ScannedDefinition } from './discovery.ts';
import type { McpServerConfig } from './mcp-json.ts';
import type { RedirectSettings } from './redirects.ts';
import type { HooksConfig } from './settings-files.ts';
import {
  DEFAULT_AGENT_SETTINGS,
  agentSettingsFor,
  conversationProjectIds,
  enabledProjectMcp,
  type AgentSettingsRow,
} from './store.ts';
import { trustFor } from './trust-store.ts';
import { trustedParts, type TrustRow } from './trust.ts';
import { hooksApproved } from './view.ts';

export interface InstructionText {
  path: string;
  text: string;
}

export interface RepoRootLaunch {
  root: string;
  label: string;
  instructions: InstructionText[] | null;
  nested: string[];
  skills: ScannedDefinition[] | null;
  commands: ScannedDefinition[];
  subagents: ScannedDefinition[];
  hooks: HooksConfig | null;
  mcpServers: McpServerConfig[];
  allowRules: string[];
  redirects: RedirectSettings | null;
}

export type RepoLaunch = RepoRootLaunch[];

const FILE_TEXT_MAX = 24 * 1024;

async function instructionText(root: string, path: string): Promise<InstructionText | null> {
  try {
    const text = await readFile(join(root, path), 'utf8');
    const clipped =
      text.length > FILE_TEXT_MAX ? `${text.slice(0, FILE_TEXT_MAX)}\n[…truncated]` : text;
    return clipped.trim() === '' ? null : { path, text: clipped };
  } catch {
    return null;
  }
}

export async function rootLaunch(
  scan: RepoScan,
  settings: AgentSettingsRow,
  enabledMcp: ReadonlyMap<string, string>,
  trust: TrustRow | null = null,
): Promise<RepoRootLaunch> {
  const trusted = trustedParts(scan, trust);
  const rootFiles = scan.instructions.filter((file) => !file.nested);
  const texts = settings.instructions
    ? (await Promise.all(rootFiles.map((file) => instructionText(scan.root, file.path)))).filter(
        (text): text is InstructionText => text !== null,
      )
    : null;
  return {
    root: scan.root,
    label: basename(scan.root),
    instructions: texts,
    nested: settings.instructions
      ? scan.instructions.filter((file) => file.nested).map((file) => file.path)
      : [],
    skills: settings.skills ? scan.skills : null,
    commands: settings.commands ? scan.commands : [],
    subagents: settings.subagents ? scan.subagents : [],
    hooks: trusted ? trusted.hooks : hooksApproved(settings, scan) ? scan.hooksConfig : null,
    mcpServers: trusted
      ? trusted.mcpServers
      : scan.mcpServers.filter((server) => enabledMcp.get(server.name) === server.fingerprint),
    allowRules: trusted?.allowRules ?? [],
    redirects: trusted?.redirects ?? null,
  };
}

export async function loadRepoLaunch(
  db: Queryable,
  scanner: RepoScanner,
  conversationId: string,
  roots: readonly string[],
): Promise<RepoLaunch> {
  if (roots.length === 0) return [];
  const projectIds = (await conversationProjectIds(db, conversationId)).slice(0, roots.length);
  const [settings, mcp, trust] = await Promise.all([
    agentSettingsFor(db, projectIds),
    enabledProjectMcp(db, projectIds),
    trustFor(db, projectIds),
  ]);
  const launches: RepoLaunch = [];
  for (const [index, root] of roots.entries()) {
    const projectId = projectIds[index];
    const scan = await scanner.scan(root).catch(() => null);
    if (!scan) continue;
    const rootSettings = (projectId && settings.get(projectId)) || DEFAULT_AGENT_SETTINGS;
    const enabled = (projectId && mcp.get(projectId)) || new Map<string, string>();
    const rootTrust = (projectId && trust.get(projectId)) || null;
    launches.push(await rootLaunch(scan, rootSettings, enabled, rootTrust));
  }
  return launches;
}
