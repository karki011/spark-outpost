import { describe, expect, it } from 'vitest';
import { isShipBranch, safeToPush, shipBranchName, taskSlug } from './branch.ts';

const TASK = '1a2b3c4d-0000-4000-8000-000000000000';

describe('ship branch names', () => {
  it('slugs the task title under the channel prefix with a short task id', () => {
    expect(shipBranchName('spark', 'Fix the login divider!', TASK)).toBe(
      'spark/fix-the-login-divider-1a2b3c4d',
    );
    expect(shipBranchName('spark-dev', 'Fix the login divider!', TASK)).toBe(
      'spark-dev/fix-the-login-divider-1a2b3c4d',
    );
  });

  it('drops accents, symbols and cuts long titles at a word', () => {
    expect(taskSlug('Résumé export: ünicode & “quotes”')).toBe('resume-export-unicode-quotes');
    const long = taskSlug('Add a settings page that lets people pick a theme and a font size');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe('add-a-settings-page-that-lets-people');
    expect(taskSlug('!!!')).toBe('task');
  });

  it('only accepts its own prefixed branches for pushing', () => {
    const branch = shipBranchName('spark', 'Tidy', TASK);
    expect(isShipBranch(branch, 'spark')).toBe(true);
    expect(isShipBranch('main', 'spark')).toBe(false);
    expect(isShipBranch('spark-dev/x-1', 'spark')).toBe(false);
    expect(safeToPush(branch, 'spark', ['main', null])).toBe(true);
    expect(safeToPush(branch, 'spark', [branch])).toBe(false);
  });
});
