import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { McpImportTool, McpScanSource } from '@spark-outpost/contracts';
import type { McpServerConfig } from '../agent-config/mcp-json.ts';
import { importSources, type SourceHomes } from './sources.ts';

const FILE_MAX_BYTES = 16 * 1024 * 1024;

export interface ScannedServer {
  tool: McpImportTool;
  origin: string;
  server: McpServerConfig;
}

export interface UserMcpScan {
  sources: McpScanSource[];
  servers: ScannedServer[];
}

export function defaultHomes(env: NodeJS.ProcessEnv = process.env): SourceHomes {
  const home = env.HOME || homedir();
  return { home, codexHome: env.CODEX_HOME || join(home, '.codex') };
}

export function scanHomesAt(home: string): SourceHomes {
  return { home, codexHome: join(home, '.codex') };
}

async function readSmall(path: string): Promise<string | null | 'too-big'> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    if (info.size > FILE_MAX_BYTES) return 'too-big';
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function scanUserMcp(homes: SourceHomes = defaultHomes()): Promise<UserMcpScan> {
  const scan: UserMcpScan = { sources: [], servers: [] };
  const taken = new Set<string>();
  for (const source of importSources(homes)) {
    const text = await readSmall(source.path);
    const base = { tool: source.tool, label: source.label, path: source.path };
    if (text === null) {
      scan.sources.push({ ...base, found: false, servers: 0, warnings: [] });
      continue;
    }
    if (text === 'too-big') {
      const warning = `${source.path} is over 16 MB, so it was skipped.`;
      scan.sources.push({ ...base, found: true, servers: 0, warnings: [warning] });
      continue;
    }
    const parsed = source.parse(text);
    const warnings = [...parsed.warnings];
    let count = 0;
    for (const server of parsed.servers) {
      const key = `${source.tool}:${server.name}`;
      if (taken.has(key)) {
        warnings.push(`${source.label}: "${server.name}" is already listed, so it was skipped.`);
        continue;
      }
      taken.add(key);
      count += 1;
      scan.servers.push({ tool: source.tool, origin: source.path, server });
    }
    scan.sources.push({ ...base, found: true, servers: count, warnings });
  }
  return scan;
}

export async function findScanned(
  homes: SourceHomes,
  tool: string,
  name: string,
): Promise<ScannedServer | null> {
  const scan = await scanUserMcp(homes);
  return scan.servers.find((entry) => entry.tool === tool && entry.server.name === name) ?? null;
}
