import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ScannedDefinition } from './discovery.ts';
import { parseFrontmatter, renderFrontmatter } from './frontmatter.ts';
import type { RepoRootLaunch } from './launch.ts';

const KEPT_FIELDS = {
  skills: ['name', 'description', 'argument-hint', 'when_to_use', 'disable-model-invocation'],
  commands: ['description', 'argument-hint'],
  agents: ['name', 'description', 'tools', 'disallowedTools', 'model', 'color'],
} as const;

type Kind = keyof typeof KEPT_FIELDS;

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

export function sanitizedDefinition(kind: Kind, text: string, note: string | null): string {
  const { fields, body } = parseFrontmatter(text);
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key]) =>
      (KEPT_FIELDS[kind] as readonly string[]).includes(key),
    ),
  );
  return renderFrontmatter(kept, note ? `${body.trimEnd()}\n\n${note}\n` : body);
}

function skillDir(definition: ScannedDefinition): string {
  return definition.path.slice(0, definition.path.lastIndexOf('/'));
}

function outputPath(kind: Kind, definition: ScannedDefinition): string {
  if (kind === 'skills') return `skills/${definition.name.replace(/[/\\]/g, '-')}/SKILL.md`;
  if (kind === 'commands') return `commands/${definition.name.split(':').join('/')}.md`;
  return `agents/${definition.path.slice(definition.path.lastIndexOf('/') + 1)}`;
}

async function definitionFiles(
  root: string,
  kind: Kind,
  definitions: readonly ScannedDefinition[],
): Promise<PluginFile[]> {
  const files: PluginFile[] = [];
  const seen = new Set<string>();
  for (const definition of definitions) {
    const path = outputPath(kind, definition);
    if (seen.has(path)) continue;
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
    files.push({ path, text: sanitizedDefinition(kind, text, note) });
  }
  return files;
}

export async function pluginFiles(launch: RepoRootLaunch, name: string): Promise<PluginFile[]> {
  const content = [
    ...(await definitionFiles(launch.root, 'skills', launch.skills ?? [])),
    ...(await definitionFiles(launch.root, 'commands', launch.commands)),
    ...(await definitionFiles(launch.root, 'agents', launch.subagents)),
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
  for (const file of files) {
    await mkdir(dirname(join(staging, file.path)), { recursive: true });
    await writeFile(join(staging, file.path), file.text);
  }
  try {
    await rename(staging, target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (!(await exists(target))) throw error;
  }
  return target;
}
