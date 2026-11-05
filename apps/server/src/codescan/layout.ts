import { CODEOWNERS_PATHS, parseCodeowners, type OwnerRule } from './owners.ts';

export interface WorkspacePackage {
  root: string;
  name: string;
}

export interface ProjectLayout {
  tools: string[];
  packages: WorkspacePackage[];
  instructions: string[];
  owners: OwnerRule[];
  searchExcludes: string[];
}

export type ReadText = (path: string) => Promise<string | null>;

const MANIFESTS = ['package.json', 'project.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];

const TOOL_FILES: Record<string, string> = {
  'pnpm-workspace.yaml': 'pnpm',
  'nx.json': 'nx',
  'turbo.json': 'turbo',
  'lerna.json': 'lerna',
  'go.work': 'go',
};

const INSTRUCTION_FILE =
  /(?:^|\/)(?:CLAUDE\.md|AGENTS\.md|CONTRIBUTING\.md|\.cursorrules|\.github\/copilot-instructions\.md)$|(?:^|\/)\.cursor\/rules\//;

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

function jsonName(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { name?: unknown };
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}

function tomlName(text: string, sections: readonly string[]): string | null {
  let section = '';
  for (const line of text.split('\n')) {
    const header = /^\s*\[([^\]]+)\]/.exec(line);
    if (header) {
      section = header[1]?.trim() ?? '';
      continue;
    }
    const name = /^\s*name\s*=\s*["']([^"']+)["']/.exec(line);
    if (name && sections.includes(section)) return name[1] ?? null;
  }
  return null;
}

export function manifestName(file: string, text: string): string | null {
  switch (file) {
    case 'package.json':
    case 'project.json':
      return jsonName(text);
    case 'Cargo.toml':
      return tomlName(text, ['package']);
    case 'pyproject.toml':
      return tomlName(text, ['project', 'tool.poetry']);
    case 'go.mod':
      return /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
    default:
      return null;
  }
}

function detectTools(paths: ReadonlySet<string>, rootManifests: Map<string, string>): string[] {
  const tools = Object.entries(TOOL_FILES)
    .filter(([file]) => paths.has(file))
    .map(([, tool]) => tool);
  if (/"workspaces"\s*:/.test(rootManifests.get('package.json') ?? '')) tools.push('workspaces');
  if (/^\s*\[workspace\]/m.test(rootManifests.get('Cargo.toml') ?? '')) tools.push('cargo');
  return tools;
}

async function readPackages(manifests: readonly string[], read: ReadText) {
  const named = new Map<string, WorkspacePackage>();
  const rootManifests = new Map<string, string>();
  for (const path of manifests) {
    const text = await read(path);
    if (text === null) continue;
    const root = directoryOf(path);
    if (root === '.') rootManifests.set(baseName(path), text);
    const name = manifestName(baseName(path), text);
    const existing = named.get(root);
    if (!existing || (existing.name === root && name))
      named.set(root, { root, name: name ?? root });
  }
  return { packages: [...named.values()], rootManifests };
}

export async function readLayout(paths: readonly string[], read: ReadText): Promise<ProjectLayout> {
  const all = new Set(paths);
  const manifests = paths.filter((path) => MANIFESTS.includes(baseName(path)));
  const { packages, rootManifests } = await readPackages(manifests, read);
  const ownersPath = CODEOWNERS_PATHS.find((path) => all.has(path));
  const ownersText = ownersPath ? await read(ownersPath) : null;
  return {
    tools: detectTools(all, rootManifests),
    packages: packages.sort((a, b) => a.root.localeCompare(b.root)),
    instructions: paths.filter((path) => INSTRUCTION_FILE.test(path)).sort(),
    owners: ownersText ? parseCodeowners(ownersText) : [],
    searchExcludes: [],
  };
}

export function packageMatcher(packages: readonly WorkspacePackage[]): (path: string) => string {
  const byRoot = new Map(packages.map((entry) => [entry.root, entry.name]));
  const byDirectory = new Map<string, string>();
  const nameFor = (directory: string): string => {
    const known = byDirectory.get(directory);
    if (known !== undefined) return known;
    const name =
      byRoot.get(directory) ?? (directory === '.' ? '.' : nameFor(directoryOf(directory)));
    byDirectory.set(directory, name);
    return name;
  };
  return (path) => nameFor(directoryOf(path));
}
