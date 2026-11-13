import {
  CREW_FILE_MAX_BYTES,
  CREW_FILES_MAX,
  CREW_SLUG_PATTERN,
  SKILL_DESCRIPTION_MAX,
  SKILL_FILE,
  SKILLS_FOLDER,
  SPARK_INSTRUCTIONS_FILE,
  crewPathProblem,
  parseSkillFile,
  skillOfPath,
  type CrewFileEntry,
} from '@spark-outpost/contracts';

export interface TreeNode {
  name: string;
  path: string;
  kind: 'folder' | 'file';
  children: TreeNode[];
}

export interface TreeRow {
  node: TreeNode;
  depth: number;
  open: boolean;
}

function rank(node: TreeNode): number {
  if (node.path === SPARK_INSTRUCTIONS_FILE) return 0;
  if (node.kind === 'file' && node.name === SKILL_FILE) return 1;
  if (node.path === SKILLS_FOLDER) return 2;
  return node.kind === 'folder' ? 3 : 4;
}

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  for (const node of nodes) sortNodes(node.children);
  return nodes.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function buildTree(files: readonly CrewFileEntry[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const folders = new Map<string, TreeNode>();
  const paths = new Set(files.map((file) => file.path));
  paths.add(SPARK_INSTRUCTIONS_FILE);
  for (const path of paths) {
    const segments = path.split('/');
    let siblings = roots;
    segments.forEach((name, index) => {
      const at = segments.slice(0, index + 1).join('/');
      if (index === segments.length - 1) {
        siblings.push({ name, path: at, kind: 'file', children: [] });
        return;
      }
      let folder = folders.get(at);
      if (!folder) {
        folder = { name, path: at, kind: 'folder', children: [] };
        folders.set(at, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    });
  }
  return sortNodes(roots);
}

export function treeRows(
  nodes: readonly TreeNode[],
  closed: ReadonlySet<string>,
  depth = 0,
): TreeRow[] {
  return nodes.flatMap((node) => {
    const open = node.kind === 'folder' && !closed.has(node.path);
    const row: TreeRow = { node, depth, open };
    return open ? [row, ...treeRows(node.children, closed, depth + 1)] : [row];
  });
}

export function skillFilePath(name: string): string {
  return `${SKILLS_FOLDER}/${name}/${SKILL_FILE}`;
}

export function newSkillText(name: string, description: string): string {
  const summary = description.trim().replace(/\s+/g, ' ');
  return [
    '---',
    `name: ${name}`,
    `description: ${summary}`,
    '---',
    '',
    'Say when to use this skill, then list the steps to follow.',
    '',
  ].join('\n');
}

function taken(path: string, files: readonly CrewFileEntry[]): boolean {
  return files.some((file) => file.path === path);
}

function isFolder(path: string, files: readonly CrewFileEntry[]): boolean {
  return files.some((file) => file.path.startsWith(`${path}/`));
}

function underFile(path: string, files: readonly CrewFileEntry[]): boolean {
  return files.some((file) => path.startsWith(`${file.path}/`));
}

export function skillNameProblem(name: string, files: readonly CrewFileEntry[]): string | null {
  if (name.length === 0) return 'Enter a skill name.';
  if (!CREW_SLUG_PATTERN.test(name)) {
    return 'Use 2 to 40 lower-case letters, numbers and hyphens, starting with a letter.';
  }
  if (isFolder(`${SKILLS_FOLDER}/${name}`, files))
    return `This Spark already has a skill named ${name}.`;
  return files.length >= CREW_FILES_MAX ? fullFolder() : null;
}

export function skillDescriptionProblem(description: string): string | null {
  const text = description.trim();
  if (text.length === 0) return 'Say in a sentence when the Spark should use this skill.';
  if (text.length > SKILL_DESCRIPTION_MAX) {
    return `Keep the description to ${SKILL_DESCRIPTION_MAX} characters.`;
  }
  return null;
}

function fullFolder(): string {
  return `A Spark folder holds at most ${CREW_FILES_MAX} files.`;
}

export function newFileProblem(path: string, files: readonly CrewFileEntry[]): string | null {
  const shape = crewPathProblem(path);
  if (shape) return shape;
  if (taken(path, files) || path === SPARK_INSTRUCTIONS_FILE) {
    return 'A file with that name already exists.';
  }
  if (isFolder(path, files)) return 'A folder with that name already exists.';
  if (underFile(path, files)) return 'That path goes through a file, not a folder.';
  return files.length >= CREW_FILES_MAX ? fullFolder() : null;
}

export function fixedName(path: string): boolean {
  return path === SPARK_INSTRUCTIONS_FILE || isSkillFile(path);
}

export function isSkillFile(path: string): boolean {
  const segments = path.split('/');
  return segments.length === 3 && segments[0] === SKILLS_FOLDER && segments[2] === SKILL_FILE;
}

export function renameProblem(
  from: string,
  to: string,
  files: readonly CrewFileEntry[],
): string | null {
  if (to === from) return 'Enter a different name.';
  return newFileProblem(
    to,
    files.filter((file) => file.path !== from),
  );
}

export function textProblem(path: string, text: string): string | null {
  if (new TextEncoder().encode(text).length > CREW_FILE_MAX_BYTES) {
    return `A file can hold at most ${CREW_FILE_MAX_BYTES / 1024} KB.`;
  }
  if (!isSkillFile(path)) return null;
  const parsed = parseSkillFile(text);
  if (parsed.problem) return parsed.problem;
  const folder = skillOfPath(path);
  return parsed.skill && parsed.skill.name !== folder
    ? `The name in this file is ${parsed.skill.name}, but its folder is ${folder}. Make them match.`
    : null;
}

export type SaveFailure =
  | { kind: 'changed'; text: string }
  | { kind: 'exists'; text: string }
  | { kind: 'error'; text: string };

export function saveFailure(error: unknown, baseHash: string | null): SaveFailure {
  const status =
    typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
  if (status === 409 && baseHash === null) {
    return { kind: 'exists', text: 'A file with that name already exists.' };
  }
  if (status === 409) {
    return {
      kind: 'changed',
      text: 'This file changed since you opened it. Reload to see the new version, or save yours over it.',
    };
  }
  const reason = error instanceof Error ? error.message : 'The server could not be reached.';
  return { kind: 'error', text: `Not saved. ${reason}` };
}

export function parentFolder(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

export function skillCountLabel(count: number): string {
  return count === 0 ? 'No skills' : `${count} ${count === 1 ? 'skill' : 'skills'}`;
}
