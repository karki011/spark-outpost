import { describe, expect, it } from 'vitest';
import { parseSkillFile, type CrewFileEntry } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import {
  buildTree,
  fixedName,
  newFileProblem,
  newSkillText,
  parentFolder,
  renameProblem,
  saveFailure,
  skillCountLabel,
  skillDescriptionProblem,
  skillFilePath,
  skillNameProblem,
  textProblem,
  treeRows,
  type TreeNode,
} from './folder-model.ts';

const entries = (...paths: string[]): CrewFileEntry[] => paths.map((path) => ({ path, bytes: 1 }));

function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [
    `${'  '.repeat(depth)}${node.name}${node.kind === 'folder' ? '/' : ''}`,
    ...outline(node.children, depth + 1),
  ]);
}

describe('buildTree', () => {
  it('nests files under their folders, instructions first and each SKILL.md first in its skill', () => {
    const tree = buildTree(
      entries(
        'notes.txt',
        'skills/secret-scan/patterns.txt',
        'skills/secret-scan/SKILL.md',
        'skills/dependency-audit/scripts/audit.sh',
        'skills/dependency-audit/SKILL.md',
        'SPARK.md',
        'assets/logo.txt',
      ),
    );
    expect(outline(tree)).toEqual([
      'SPARK.md',
      'skills/',
      '  dependency-audit/',
      '    SKILL.md',
      '    scripts/',
      '      audit.sh',
      '  secret-scan/',
      '    SKILL.md',
      '    patterns.txt',
      'assets/',
      '  logo.txt',
      'notes.txt',
    ]);
  });

  it('always lists SPARK.md, so instructions can be written for an empty folder', () => {
    expect(outline(buildTree([]))).toEqual(['SPARK.md']);
    expect(outline(buildTree(entries('a.txt')))).toEqual(['SPARK.md', 'a.txt']);
  });

  it('gives every node its full path', () => {
    const [, skills] = buildTree(entries('skills/audit/SKILL.md'));
    expect(skills?.path).toBe('skills');
    expect(skills?.children[0]?.path).toBe('skills/audit');
    expect(skills?.children[0]?.children[0]?.path).toBe('skills/audit/SKILL.md');
  });
});

describe('treeRows', () => {
  const tree = buildTree(entries('SPARK.md', 'skills/audit/SKILL.md', 'skills/audit/run.sh'));

  it('lists open folders with their depth', () => {
    expect(treeRows(tree, new Set()).map((row) => [row.node.path, row.depth])).toEqual([
      ['SPARK.md', 0],
      ['skills', 0],
      ['skills/audit', 1],
      ['skills/audit/SKILL.md', 2],
      ['skills/audit/run.sh', 2],
    ]);
  });

  it('hides everything under a closed folder', () => {
    const rows = treeRows(tree, new Set(['skills']));
    expect(rows.map((row) => row.node.path)).toEqual(['SPARK.md', 'skills']);
    expect(rows[1]?.open).toBe(false);
  });
});

describe('new skill', () => {
  it('writes a SKILL.md that parses back to the same name and description', () => {
    const text = newSkillText('dependency-audit', '  Check changed\n dependencies.  ');
    expect(
      text.startsWith(
        '---\nname: dependency-audit\ndescription: Check changed dependencies.\n---\n',
      ),
    ).toBe(true);
    const parsed = parseSkillFile(text);
    expect(parsed.problem).toBeNull();
    expect(parsed.skill).toEqual({
      name: 'dependency-audit',
      description: 'Check changed dependencies.',
    });
    expect(textProblem(skillFilePath('dependency-audit'), text)).toBeNull();
  });

  it('puts the file in its own skill folder', () => {
    expect(skillFilePath('secret-scan')).toBe('skills/secret-scan/SKILL.md');
  });

  it('refuses names that are not slugs or are taken', () => {
    const files = entries('skills/audit/SKILL.md');
    expect(skillNameProblem('', files)).toBe('Enter a skill name.');
    expect(skillNameProblem('Dependency Audit', files)).toContain('lower-case');
    expect(skillNameProblem('a', files)).toContain('2 to 40');
    expect(skillNameProblem('audit', files)).toBe('This Spark already has a skill named audit.');
    expect(skillNameProblem('secret-scan', files)).toBeNull();
  });

  it('needs a description of at most 300 characters', () => {
    expect(skillDescriptionProblem('   ')).toContain('Say in a sentence');
    expect(skillDescriptionProblem('x'.repeat(301))).toContain('300');
    expect(skillDescriptionProblem('Check dependencies.')).toBeNull();
  });

  it('refuses another file once the folder is full', () => {
    const full = entries(...Array.from({ length: 200 }, (_, index) => `f${index}.txt`));
    expect(skillNameProblem('audit', full)).toContain('at most 200 files');
    expect(newFileProblem('one-more.txt', full)).toContain('at most 200 files');
  });
});

describe('newFileProblem and renameProblem', () => {
  const files = entries('SPARK.md', 'skills/audit/SKILL.md', 'skills/audit/run.sh');

  it('passes the shared path rules through', () => {
    expect(newFileProblem('', files)).toBe('Enter a file name.');
    expect(newFileProblem('skills/audit/', files)).toContain('Folder and file names');
    expect(newFileProblem('../outside.txt', files)).toContain('Folder and file names');
    expect(newFileProblem('/etc/passwd', files)).toContain('inside the Spark folder');
  });

  it('refuses a name that is a file, a folder or under a file', () => {
    expect(newFileProblem('skills/audit/run.sh', files)).toBe(
      'A file with that name already exists.',
    );
    expect(newFileProblem('SPARK.md', [])).toBe('A file with that name already exists.');
    expect(newFileProblem('skills/audit', files)).toBe('A folder with that name already exists.');
    expect(newFileProblem('skills/audit/run.sh/more.txt', files)).toBe(
      'That path goes through a file, not a folder.',
    );
    expect(newFileProblem('skills/audit/scripts/check.sh', files)).toBeNull();
  });

  it('lets a file move, but not onto itself or another file', () => {
    expect(renameProblem('skills/audit/run.sh', 'skills/audit/run.sh', files)).toBe(
      'Enter a different name.',
    );
    expect(renameProblem('skills/audit/run.sh', 'skills/audit/SKILL.md', files)).toBe(
      'A file with that name already exists.',
    );
    expect(renameProblem('skills/audit/run.sh', 'skills/audit/check.sh', files)).toBeNull();
  });

  it('keeps the names Spark looks for fixed', () => {
    expect(fixedName('SPARK.md')).toBe(true);
    expect(fixedName('skills/audit/SKILL.md')).toBe(true);
    expect(fixedName('skills/audit/notes/SKILL.md')).toBe(false);
    expect(fixedName('skills/audit/run.sh')).toBe(false);
  });

  it('starts a new file beside the open one', () => {
    expect(parentFolder('skills/audit/run.sh')).toBe('skills/audit/');
    expect(parentFolder('SPARK.md')).toBe('');
  });
});

describe('textProblem', () => {
  it('reports a skill file without its block, and a name that differs from its folder', () => {
    expect(textProblem('skills/audit/SKILL.md', 'Just text.')).toContain('between --- lines');
    expect(
      textProblem('skills/audit/SKILL.md', '---\nname: other\ndescription: Does things.\n---\n'),
    ).toBe('The name in this file is other, but its folder is audit. Make them match.');
    expect(textProblem('skills/audit/SKILL.md', '---\nname: audit\n---\n')).toContain(
      'needs a description',
    );
  });

  it('checks only skill files for the block', () => {
    expect(textProblem('SPARK.md', 'Just text.')).toBeNull();
    expect(textProblem('skills/audit/run.sh', 'Just text.')).toBeNull();
  });

  it('refuses text over the file size limit, counted in bytes', () => {
    expect(textProblem('SPARK.md', 'a'.repeat(256 * 1024))).toBeNull();
    expect(textProblem('SPARK.md', 'é'.repeat(200 * 1024))).toBe('A file can hold at most 256 KB.');
  });
});

describe('saveFailure', () => {
  it('reads a 409 on an opened file as changed since it was opened', () => {
    const failure = saveFailure(new ApiError(409, 'Stale.'), 'hash-1');
    expect(failure.kind).toBe('changed');
    expect(failure.text).toContain('changed since you opened it');
  });

  it('reads a 409 on a new file as a name that is taken', () => {
    expect(saveFailure(new ApiError(409, 'Taken.'), null)).toEqual({
      kind: 'exists',
      text: 'A file with that name already exists.',
    });
  });

  it('passes any other failure on with its reason', () => {
    expect(saveFailure(new ApiError(500, 'The disk is full.'), 'hash-1')).toEqual({
      kind: 'error',
      text: 'Not saved. The disk is full.',
    });
    expect(saveFailure('boom', null)).toEqual({
      kind: 'error',
      text: 'Not saved. The server could not be reached.',
    });
  });
});

describe('skillCountLabel', () => {
  it('counts in words', () => {
    expect(skillCountLabel(0)).toBe('No skills');
    expect(skillCountLabel(1)).toBe('1 skill');
    expect(skillCountLabel(3)).toBe('3 skills');
  });
});
