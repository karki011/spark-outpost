import { describe, expect, it } from 'vitest';
import type { Project } from '@spark-outpost/contracts';
import { ADD_FOLDER_LABEL, CLONE_LABEL, defaultFolderPath, folderActions } from './add-folder.ts';

function project(rootPath: string, createdAt: string): Project {
  return {
    id: crypto.randomUUID(),
    name: rootPath.split('/').at(-1)!,
    rootPath,
    displayPath: rootPath,
    createdAt,
    commandAllowlist: [],
  };
}

const noop = () => undefined;

describe('default folder for the Mac dialog', () => {
  it('opens next to the newest project', () => {
    const projects = [
      project('/Users/maya/Code/old', '2026-01-01T00:00:00Z'),
      project('/Users/maya/Documents/new', '2026-05-01T00:00:00Z'),
    ];
    expect(defaultFolderPath(projects)).toBe('/Users/maya/Documents');
  });

  it('leaves the choice to the Mac without projects or for a top-level folder', () => {
    expect(defaultFolderPath([])).toBeNull();
    expect(defaultFolderPath([project('/srv', '2026-01-01T00:00:00Z')])).toBeNull();
  });
});

describe('picker actions', () => {
  it('ends every picker with Add folder and Clone a repository', () => {
    const actions = folderActions({
      place: 'this-mac',
      allowed: true,
      onAddFolder: noop,
      onClone: noop,
    });
    expect(actions.map((action) => action.label)).toEqual([ADD_FOLDER_LABEL, CLONE_LABEL]);
    expect(actions[0]!.description).toBe('Pick or make a folder on this Mac');
    expect(actions.every((action) => !action.disabled)).toBe(true);
  });

  it('speaks of your Mac on a paired device', () => {
    const [add, clone] = folderActions({
      place: 'remote',
      allowed: true,
      onAddFolder: noop,
      onClone: noop,
    });
    expect(add!.description).toBe('Pick or make a folder on your Mac');
    expect(clone!.description).toBe('Spark clones it on your Mac');
  });

  it('shows both rows disabled with the reason when the switch is off', () => {
    const actions = folderActions({
      place: 'remote',
      allowed: false,
      onAddFolder: noop,
      onClone: noop,
    });
    expect(actions.every((action) => action.disabled)).toBe(true);
    expect(actions[0]!.description).toBe('Turned off for remote control on your Mac');
  });
});
