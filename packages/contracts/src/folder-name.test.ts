import { describe, expect, it } from 'vitest';
import { createFolderRequestSchema, folderNameProblem } from './projects.ts';

describe('folder names', () => {
  it('accepts an ordinary name and trims it', () => {
    expect(folderNameProblem('  invoice tool ')).toBeNull();
    expect(createFolderRequestSchema.parse({ parent: '/Users/maya', name: ' app ' }).name).toBe(
      'app',
    );
  });

  it('refuses names that would leave the parent folder or hide the folder', () => {
    expect(folderNameProblem('')).toBe('Name the folder.');
    expect(folderNameProblem('   ')).toBe('Name the folder.');
    expect(folderNameProblem('../escape')).toBe('Folder names can’t contain / or :.');
    expect(folderNameProblem('a/b')).toBe('Folder names can’t contain / or :.');
    expect(folderNameProblem('a:b')).toBe('Folder names can’t contain / or :.');
    expect(folderNameProblem('tab\there')).toBe('Folder names can’t contain / or :.');
    expect(folderNameProblem('..')).toBe('Folder names can’t start with a dot.');
    expect(folderNameProblem('.git')).toBe('Folder names can’t start with a dot.');
  });

  it('counts the length in bytes, as the disk does', () => {
    expect(folderNameProblem('a'.repeat(255))).toBeNull();
    expect(folderNameProblem('é'.repeat(128))).toBe('That name is too long.');
  });

  it('rejects a request whose name has a problem', () => {
    expect(createFolderRequestSchema.safeParse({ parent: '/Users/maya', name: '..' }).success).toBe(
      false,
    );
  });
});
