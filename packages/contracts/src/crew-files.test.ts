import { describe, expect, it } from 'vitest';
import { crewPathProblem, crewSlug, parseSkillFile, skillOfPath } from './crew-files.ts';

describe('crewSlug', () => {
  it('turns a name into a slug', () => {
    expect(crewSlug('Pre-PR review')).toBe('pre-pr-review');
    expect(crewSlug('  Docs!  ')).toBe('docs');
  });

  it('always starts with a letter and has at least two characters', () => {
    expect(crewSlug('42 checks')).toBe('s-42-checks');
    expect(crewSlug('')).toBe('s-1');
    expect(crewSlug('a')).toBe('a-1');
  });

  it('cuts long names without a trailing hyphen', () => {
    const slug = crewSlug(`${'a'.repeat(39)} b`);
    expect(slug).toBe('a'.repeat(39));
  });
});

describe('crewPathProblem', () => {
  it('accepts paths inside the folder', () => {
    expect(crewPathProblem('SPARK.md')).toBeNull();
    expect(crewPathProblem('skills/dependency-audit/scripts/audit.sh')).toBeNull();
  });

  it('refuses paths that leave the folder or hide files', () => {
    for (const path of [
      '',
      '/etc/passwd',
      '../other/SPARK.md',
      'skills/../x',
      '.env',
      'a\\b',
      'a//b',
    ]) {
      expect(crewPathProblem(path), path).not.toBeNull();
    }
  });

  it('refuses paths that are too deep or too long', () => {
    expect(crewPathProblem('a/b/c/d/e/f/g.txt')).not.toBeNull();
    expect(crewPathProblem(`${'a'.repeat(201)}`)).not.toBeNull();
  });
});

describe('parseSkillFile', () => {
  it('reads name and description and returns the body', () => {
    const parsed = parseSkillFile(
      '---\r\nname: dependency-audit\r\ndescription: "Check changed dependencies."\r\n---\r\n\r\nRun the script.\r\n',
    );
    expect(parsed.problem).toBeNull();
    expect(parsed.skill).toEqual({
      name: 'dependency-audit',
      description: 'Check changed dependencies.',
    });
    expect(parsed.body).toBe('\nRun the script.\n');
  });

  it('reports a missing block, name or description', () => {
    expect(parseSkillFile('Just text').problem).toContain('SKILL.md');
    expect(parseSkillFile('---\ndescription: x\n---\n').problem).toContain('name');
    expect(parseSkillFile('---\nname: Bad Name\ndescription: x\n---\n').problem).toContain('name');
    expect(parseSkillFile('---\nname: audit\n---\n').problem).toContain('description');
  });
});

describe('skillOfPath', () => {
  it('names the skill a file belongs to', () => {
    expect(skillOfPath('skills/audit/SKILL.md')).toBe('audit');
    expect(skillOfPath('skills/audit/scripts/run.sh')).toBe('audit');
    expect(skillOfPath('SPARK.md')).toBeNull();
    expect(skillOfPath('skills/readme.txt')).toBeNull();
  });
});
