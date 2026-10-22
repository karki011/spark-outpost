import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { IgnoredSetting, RepoHook, RepoInstructionFile } from '@spark-outpost/contracts';
import { listProjectFiles } from '../codescan/git.ts';
import { fingerprintOf } from './fingerprint.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { readMcpJson, type McpServerConfig } from './mcp-json.ts';
import { PROJECT_SETTINGS_FILES } from './permission-rules.ts';
import type { RedirectSetting } from './redirects.ts';
import {
  emptySummary,
  preview,
  readSettingsFile,
  type HooksConfig,
  type SourcedAllowRule,
} from './settings-files.ts';

export interface ScannedDefinition {
  name: string;
  description: string;
  path: string;
}

export interface RepoScan {
  root: string;
  instructions: RepoInstructionFile[];
  skills: ScannedDefinition[];
  commands: ScannedDefinition[];
  subagents: ScannedDefinition[];
  hooks: RepoHook[];
  hooksConfig: HooksConfig;
  hooksFingerprint: string | null;
  mcpServers: McpServerConfig[];
  allowRules: SourcedAllowRule[];
  redirects: RedirectSetting[];
  ignored: IgnoredSetting[];
  warnings: string[];
}

const ROOT_INSTRUCTION_FILES = [
  'CLAUDE.md',
  '.claude/CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
] as const;
const NESTED_INSTRUCTION = /(?:^|\/)(?:CLAUDE|AGENTS)\.md$/;
const CURSOR_RULES = '.cursor/rules';
const MCP_FILE = '.mcp.json';
const CODEX_CONFIG = '.codex/config.toml';
const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills'] as const;
const DEFINITION_DIRS = [...SKILL_DIRS, '.claude/commands', '.claude/agents', CURSOR_RULES];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_ENTRIES = 200;
const MAX_DEPTH = 3;
const DESCRIPTION_MAX = 300;

const run = promisify(execFile);

interface Stamp {
  path: string;
  mtimeMs: number;
  size: number;
}

async function stampOf(root: string, path: string): Promise<Stamp | null> {
  try {
    const info = await stat(join(root, path));
    return info.isFile() ? { path, mtimeMs: info.mtimeMs, size: info.size } : null;
  } catch {
    return null;
  }
}

async function walk(root: string, dir: string, depth = 0): Promise<Stamp[]> {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return [];
  }
  const stamps: Stamp[] = [];
  for (const entry of entries.slice(0, MAX_ENTRIES)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) stamps.push(...(await walk(root, path, depth + 1)));
    else if (entry.isFile()) {
      const stamp = await stampOf(root, path);
      if (stamp) stamps.push(stamp);
    }
  }
  return stamps;
}

async function gitHead(root: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['-C', root, 'rev-parse', 'HEAD'], { timeout: 2_000 });
    return stdout.trim();
  } catch {
    return 'no-git';
  }
}

async function readText(root: string, stamp: Stamp): Promise<string | null> {
  if (stamp.size > MAX_FILE_BYTES) return null;
  try {
    return await readFile(join(root, stamp.path), 'utf8');
  } catch {
    return null;
  }
}

function shortDescription(fields: Record<string, string>, body: string): string {
  const fallback = body.split('\n').find((line) => line.trim() !== '') ?? '';
  return preview(fields.description || fallback.replace(/^#+\s*/, '')).slice(0, DESCRIPTION_MAX);
}

function baseName(path: string, suffix: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

async function definitions(
  root: string,
  stamps: Stamp[],
  pick: (path: string) => string | null,
): Promise<ScannedDefinition[]> {
  const found: ScannedDefinition[] = [];
  for (const stamp of stamps) {
    const fallbackName = pick(stamp.path);
    if (fallbackName === null) continue;
    const text = await readText(root, stamp);
    if (text === null) continue;
    const { fields, body } = parseFrontmatter(text);
    found.push({
      name: fields.name || fallbackName,
      description: shortDescription(fields, body),
      path: stamp.path,
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const skillName = (path: string) => {
  const match = /^\.(?:claude|agents|codex)\/skills\/([^/]+)\/SKILL\.md$/.exec(path);
  return match ? match[1]! : null;
};
const commandName = (path: string) => {
  const match = /^\.claude\/commands\/(.+)\.md$/.exec(path);
  return match ? match[1]!.split('/').join(':') : null;
};
const agentName = (path: string) =>
  /^\.claude\/agents\/.+\.md$/.test(path) ? baseName(path, '.md') : null;

async function nestedInstructions(root: string): Promise<Stamp[]> {
  let files: string[];
  try {
    files = await listProjectFiles(root);
  } catch {
    return [];
  }
  const nested = files
    .filter((path) => NESTED_INSTRUCTION.test(path) && path.includes('/'))
    .filter((path) => !path.startsWith('.claude/'))
    .slice(0, MAX_ENTRIES);
  const stamps = await Promise.all(nested.map((path) => stampOf(root, path)));
  return stamps.filter((stamp): stamp is Stamp => stamp !== null);
}

async function scan(root: string, stamps: Stamp[], nested: Stamp[]): Promise<RepoScan> {
  const byPath = new Map(stamps.map((stamp) => [stamp.path, stamp]));
  const rootFiles = ROOT_INSTRUCTION_FILES.flatMap((path) => byPath.get(path) ?? []);
  const cursorRules = stamps.filter(
    (stamp) => stamp.path.startsWith(`${CURSOR_RULES}/`) && /\.mdc?$/.test(stamp.path),
  );
  const instructions: RepoInstructionFile[] = [
    ...[...rootFiles, ...cursorRules].map((stamp) => ({
      path: stamp.path,
      bytes: stamp.size,
      nested: false,
    })),
    ...nested.map((stamp) => ({ path: stamp.path, bytes: stamp.size, nested: true })),
  ];
  const settings = emptySummary();
  for (const path of PROJECT_SETTINGS_FILES) {
    const stamp = byPath.get(path);
    const text = stamp ? await readText(root, stamp) : null;
    if (text !== null) readSettingsFile(text, path, settings);
  }
  const mcpStamp = byPath.get(MCP_FILE);
  const mcpText = mcpStamp ? await readText(root, mcpStamp) : null;
  const mcp = mcpText === null ? { servers: [], warnings: [] } : readMcpJson(mcpText, MCP_FILE);
  const ignored = [...settings.ignored];
  if (byPath.has(CODEX_CONFIG)) {
    ignored.push({ source: CODEX_CONFIG, kind: 'codex', items: ['Codex project config'] });
  }
  const hasHooks = Object.keys(settings.hooksConfig).length > 0;
  return {
    root,
    instructions,
    skills: await definitions(root, stamps, skillName),
    commands: await definitions(root, stamps, commandName),
    subagents: await definitions(root, stamps, agentName),
    hooks: settings.hooks,
    hooksConfig: settings.hooksConfig,
    hooksFingerprint: hasHooks ? fingerprintOf(settings.hooksConfig) : null,
    mcpServers: mcp.servers,
    allowRules: settings.allowRules,
    redirects: settings.redirects,
    ignored,
    warnings: [...settings.warnings, ...mcp.warnings],
  };
}

async function candidateStamps(root: string): Promise<Stamp[]> {
  const singles = [...ROOT_INSTRUCTION_FILES, ...PROJECT_SETTINGS_FILES, MCP_FILE, CODEX_CONFIG];
  const direct = await Promise.all(singles.map((path) => stampOf(root, path)));
  const walked = await Promise.all(DEFINITION_DIRS.map((dir) => walk(root, dir)));
  return [...direct.filter((stamp): stamp is Stamp => stamp !== null), ...walked.flat()];
}

function signatureOf(head: string, stamps: readonly Stamp[]): string {
  return fingerprintOf([head, stamps.map((stamp) => [stamp.path, stamp.mtimeMs, stamp.size])]);
}

export interface RepoScanner {
  scan(root: string): Promise<RepoScan>;
}

export function createRepoScanner(): RepoScanner {
  const cache = new Map<string, { signature: string; result: Promise<RepoScan> }>();
  return {
    async scan(root) {
      const [head, stamps] = await Promise.all([gitHead(root), candidateStamps(root)]);
      const signature = signatureOf(head, stamps);
      const cached = cache.get(root);
      if (cached?.signature === signature) return cached.result;
      const result = nestedInstructions(root).then((nested) => scan(root, stamps, nested));
      cache.set(root, { signature, result });
      result.catch(() => cache.delete(root));
      return result;
    },
  };
}

export const repoScanner = createRepoScanner();
