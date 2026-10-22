import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { folderDefaultPath, folderDialogOptions } from './folder-picker.ts';

const DOCUMENTS = '/Users/maya/Documents';

describe('folder picker', () => {
  it('lets the dialog make a new folder and opens where the user last added one', () => {
    const options = folderDialogOptions('/Users/maya/Code');
    expect(options.properties).toEqual(['openDirectory', 'createDirectory']);
    expect(options.buttonLabel).toBe('Add Folder');
    expect(options.defaultPath).toBe('/Users/maya/Code');
  });

  it('keeps an existing absolute folder the page asked for', () => {
    expect(folderDefaultPath('/Users/maya/Code', DOCUMENTS, () => true)).toBe('/Users/maya/Code');
  });

  it('falls back to Documents for anything else, and home when Documents is missing', () => {
    const only = (present: string) => (target: string) => target === present;
    for (const requested of [null, 'Code', 42, `/${'a'.repeat(5000)}`, '/gone']) {
      expect(folderDefaultPath(requested, DOCUMENTS, only(DOCUMENTS))).toBe(DOCUMENTS);
    }
    expect(folderDefaultPath(null, DOCUMENTS, () => false)).toBe(homedir());
  });
});
