import type { RepoHook } from '@spark-outpost/contracts';
import { parseFrontmatter } from '../frontmatter.ts';
import { readMcpJson, type McpServerConfig } from '../mcp-json.ts';
import { isRecord } from '../records.ts';
import { emptySummary, readSettingsFile, type HooksConfig } from '../settings-files.ts';
import type { PluginFile } from './files.ts';

export interface ParsedPlugin {
  name: string | null;
  description: string;
  skills: string[];
  commands: string[];
  commandNames: string[];
  agents: string[];
  definitionFiles: string[];
  hooks: RepoHook[];
  hooksConfig: HooksConfig;
  hookFiles: string[];
  mcpServers: McpServerConfig[];
  inlineShell: string[];
}

const MANIFESTS = ['.claude-plugin/plugin.json', 'plugin.json'] as const;
export const INLINE_SHELL = /!`[^`\n]+`/;

function parseJson(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalized(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const parts = path
    .replace(/^\.\//, '')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (path.startsWith('/') || parts.includes('..') || parts.length === 0) return null;
  return parts.join('/');
}

function manifestPaths(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) => normalized(entry) ?? []);
}

function under(paths: readonly string[], file: string): boolean {
  return paths.some((path) => file === path || file.startsWith(`${path}/`));
}

function mdFiles(files: readonly PluginFile[], roots: readonly string[]): string[] {
  return files
    .map((file) => file.path)
    .filter((path) => path.endsWith('.md') && under(roots, path));
}

function skillDirs(files: readonly PluginFile[], roots: readonly string[]): string[] {
  return files
    .map((file) => file.path)
    .filter((path) => path.endsWith('/SKILL.md') && under(roots, path));
}

function agentName(file: PluginFile): string {
  const fields = file.text ? parseFrontmatter(file.text).fields : {};
  return fields.name || file.path.slice(file.path.lastIndexOf('/') + 1, -'.md'.length);
}

function skillName(file: PluginFile | undefined, path: string): string {
  const fields = file?.text ? parseFrontmatter(file.text).fields : {};
  const dir = path.slice(0, -'/SKILL.md'.length);
  return fields.name || dir.slice(dir.lastIndexOf('/') + 1);
}

function commandName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.md'.length);
}

function uniqueAgents(byPath: Map<string, PluginFile>, paths: readonly string[]): string[] {
  const names = new Map<string, string>();
  for (const path of paths) {
    const file = byPath.get(path);
    if (file && !names.has(agentName(file))) names.set(agentName(file), path);
  }
  return [...names.values()];
}

function hooksFrom(
  manifest: Record<string, unknown>,
  byPath: Map<string, PluginFile>,
): Pick<ParsedPlugin, 'hooks' | 'hooksConfig' | 'hookFiles'> {
  const summary = emptySummary();
  const declared = manifest.hooks;
  const inline = isRecord(declared) ? [declared] : [];
  const paths = isRecord(declared) ? [] : manifestPaths(declared);
  const hookFiles = [...new Set(['hooks/hooks.json', ...paths])].filter((path) => byPath.has(path));
  for (const path of hookFiles) readSettingsFile(byPath.get(path)?.text ?? '', path, summary);
  for (const hooks of inline) readSettingsFile(JSON.stringify({ hooks }), 'plugin.json', summary);
  return {
    hooks: summary.hooks,
    hooksConfig: summary.hooksConfig,
    hookFiles,
  };
}

function mcpText(text: string | null | undefined): string | null {
  const parsed = parseJson(text);
  if (!parsed) return null;
  return JSON.stringify(isRecord(parsed.mcpServers) ? parsed : { mcpServers: parsed });
}

function mcpFrom(manifest: Record<string, unknown>, byPath: Map<string, PluginFile>) {
  const declared = manifest.mcpServers;
  const texts = isRecord(declared)
    ? [mcpText(JSON.stringify(declared))]
    : [...new Set(['.mcp.json', ...manifestPaths(declared)])].map((path) =>
        mcpText(byPath.get(path)?.text),
      );
  return texts.flatMap((text) => (text ? readMcpJson(text, 'plugin').servers : []));
}

export function pluginCommandNames(name: string, parsed: ParsedPlugin): string[] {
  return parsed.commandNames.map((command) => `${name}:${command}`);
}

export function parsePlugin(files: readonly PluginFile[]): ParsedPlugin {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifestFile = MANIFESTS.find((path) => parseJson(byPath.get(path)?.text));
  const manifest = parseJson(manifestFile ? byPath.get(manifestFile)?.text : null) ?? {};
  const skills = skillDirs(files, ['skills', ...manifestPaths(manifest.skills)]);
  const commands = mdFiles(files, ['commands', ...manifestPaths(manifest.commands)]);
  const agentFiles = mdFiles(files, ['agents', ...manifestPaths(manifest.agents)]);
  return {
    name: typeof manifest.name === 'string' && manifest.name !== '' ? manifest.name : null,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    skills,
    commands,
    commandNames: [
      ...new Set([
        ...skills.map((path) => skillName(byPath.get(path), path)),
        ...commands.map(commandName),
      ]),
    ],
    agents: uniqueAgents(byPath, agentFiles),
    definitionFiles: [...new Set([...skills, ...commands, ...agentFiles])],
    ...hooksFrom(manifest, byPath),
    mcpServers: mcpFrom(manifest, byPath),
    inlineShell: [...skills, ...commands].filter((path) =>
      INLINE_SHELL.test(byPath.get(path)?.text ?? ''),
    ),
  };
}
