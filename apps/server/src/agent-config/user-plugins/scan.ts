import type { PluginFinding, PluginScanStatus } from '@spark-outpost/contracts';
import { fingerprintOf } from '../fingerprint.ts';
import { checkPlugin, scanStatus } from './checks.ts';
import {
  filesFingerprint,
  readStatedFiles,
  statPluginFiles,
  statsSignature,
  type PluginFiles,
} from './files.ts';
import { installedPlugins, type InstalledPlugin } from './installed.ts';
import { parsePlugin, type ParsedPlugin } from './parse.ts';

export interface ScannedPlugin {
  installed: InstalledPlugin;
  files: PluginFiles;
  parsed: ParsedPlugin;
  fingerprint: string;
  findings: PluginFinding[];
  status: PluginScanStatus;
  unloadableReason: string | null;
}

const NOTHING_TO_LOAD =
  'It has no skills, commands, agents, hooks or MCP servers that load in chats.';
const UNREADABLE = "Spark couldn't read its files.";

function hasContent(parsed: ParsedPlugin): boolean {
  return (
    parsed.skills.length + parsed.commands.length + parsed.agents.length > 0 ||
    parsed.hooks.length > 0 ||
    parsed.mcpServers.length > 0
  );
}

function unscanned(installed: InstalledPlugin, reason: string): ScannedPlugin {
  const files: PluginFiles = { files: [], symlinks: [], tooLarge: null };
  return {
    installed,
    files,
    parsed: parsePlugin([]),
    fingerprint: fingerprintOf(['unloadable', installed.key, reason]),
    findings: [],
    status: 'clean',
    unloadableReason: reason,
  };
}

interface CachedScan {
  signature: string;
  scanned: ScannedPlugin;
}

const scanCache = new Map<string, CachedScan>();

function scanned(installed: InstalledPlugin, files: PluginFiles): ScannedPlugin {
  const parsed = parsePlugin(files.files);
  const findings = checkPlugin(files, parsed);
  return {
    installed,
    files,
    parsed,
    fingerprint: filesFingerprint(files),
    findings,
    status: scanStatus(findings),
    unloadableReason: files.tooLarge ?? (hasContent(parsed) ? null : NOTHING_TO_LOAD),
  };
}

async function scanRoot(installed: InstalledPlugin, root: string): Promise<ScannedPlugin> {
  const stats = await statPluginFiles(root);
  const signature = fingerprintOf([
    root,
    installed.gitCommitSha,
    installed.lastUpdated,
    statsSignature(stats),
  ]);
  const cached = scanCache.get(installed.key);
  if (cached?.signature === signature) {
    return { ...cached.scanned, installed, findings: [...cached.scanned.findings] };
  }
  const result = scanned(installed, await readStatedFiles(root, stats));
  scanCache.set(installed.key, { signature, scanned: result });
  return result;
}

export async function scanPlugin(installed: InstalledPlugin): Promise<ScannedPlugin> {
  if (!installed.root) return unscanned(installed, installed.rejected ?? UNREADABLE);
  try {
    return await scanRoot(installed, installed.root);
  } catch {
    scanCache.delete(installed.key);
    return unscanned(installed, UNREADABLE);
  }
}

export async function scanUserPlugins(configDir: string): Promise<ScannedPlugin[]> {
  const installed = await installedPlugins(configDir);
  const keys = new Set(installed.map((plugin) => plugin.key));
  for (const key of scanCache.keys()) if (!keys.has(key)) scanCache.delete(key);
  return Promise.all(installed.map(scanPlugin));
}
