import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ScannedDefinition } from './discovery.ts';
import { parseFrontmatter, renderFrontmatter } from './frontmatter.ts';
import type { RepoRootLaunch } from './launch.ts';

const KEPT_FIELDS = {
  skills: ['name', 'description', 'argument-hint', 'when_to_use', 'disable-model-invocation'],
  commands: ['description', 'argument-hint'],
  agents: ['name', 'description', 'tools', 'disallowedTools', 'model', 'color'],
} as const;

type Kind = keyof typeof KEPT_FIELDS;

const ZERO_WIDTH_SPACE = '\u200b';

interface PluginFile {
  path: string;
  text: string;
}

export function pluginName(label: string, taken: ReadonlySet<string>): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'repo';
  let name = slug;
  for (let index = 2; taken.has(name); index += 1) name = `${slug}-${index}`;
  return name;
}

function inertShell(body: string): string {
  return body.replaceAll('!`', `!${ZERO_WIDTH_SPACE}\``);
}

function sanitizedDefinition(
  kind: Kind,
  text: string,
  note: string | null,
  skillShell: boolean,
): string {
  const { fields, body } = parseFrontmatter(text);
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key]) =>
      (KEPT_FIELDS[kind] as readonly string[]).includes(key),
    ),
  );
  const shown = skillShell ? inertShell(body) : body;
  return renderFrontmatter(kept, note ? `${shown.trimEnd()}\n\n${note}\n` : shown);
}

function skillDir(definition: ScannedDefinition): string {
  return definition.path.slice(0, definition.path.lastIndexOf('/'));
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function safeSegment(segment: string): boolean {
  return SAFE_SEGMENT.test(segment) && segment !== '.' && segment !== '..';
}

function safePath(prefix: string, segments: readonly string[], suffix: string): string | null {
  if (!segments.every(safeSegment)) return null;
  return `${prefix}/${segments.join('/')}${suffix}`;
}

function outputPath(kind: Kind, definition: ScannedDefinition): string | null {
  if (kind === 'skills') return safePath('skills', [definition.name], '/SKILL.md');
  if (kind === 'commands') return safePath('commands', definition.name.split(':'), '.md');
  return safePath('agents', [definition.path.slice(definition.path.lastIndexOf('/') + 1)], '');
}

function insideDir(dir: string, path: string): string {
  const target = resolve(dir, path);
  const rel = relative(dir, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    throw new Error(`Plugin file path escapes the plugin folder: ${path}`);
  }
  return target;
}

async function definitionFiles(
  root: string,
  kind: Kind,
  definitions: readonly ScannedDefinition[],
  skillShell: boolean,
): Promise<PluginFile[]> {
  const files: PluginFile[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const path = outputPath(kind, definition);
    if (path === null || seen.has(path)) continue;
    seen.add(path);
    let text: string;
    try {
      text = await readFile(join(root, definition.path), 'utf8');
    } catch {
      continue;
    }
    const note =
      kind === 'skills'
        ? `Other files for this skill are in ${join(root, skillDir(definition))}.`
        : null;
    files.push({ path, text: sanitizedDefinition(kind, text, note, skillShell) });
  }
  return files;
}

export async function pluginFiles(
  launch: RepoRootLaunch,
  name: string,
  skillShell = false,
): Promise<PluginFile[]> {
  const content = [
    ...(await definitionFiles(launch.root, 'skills', launch.skills ?? [], skillShell)),
    ...(await definitionFiles(launch.root, 'commands', launch.commands, skillShell)),
    ...(await definitionFiles(launch.root, 'agents', launch.subagents, skillShell)),
  ];
  if (content.length === 0) return [];
  const manifest = {
    name,
    description: `Skills, commands and subagents from ${launch.label}`,
  };
  return [{ path: '.claude-plugin/plugin.json', text: JSON.stringify(manifest) }, ...content];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function writePluginDir(
  files: readonly PluginFile[],
  base = join(tmpdir(), 'spark-outpost-repo-plugins'),
): Promise<string> {
  const hash = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 24);
  const target = join(base, hash);
  if (await exists(target)) return target;
  const staging = join(base, `.staging-${randomUUID()}`);
  const targets = files.map((file) => ({ path: insideDir(staging, file.path), text: file.text }));
  for (const file of targets) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.text);
  }
  try {
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (!(await exists(target))) throw error;
  }
  return target;
}
