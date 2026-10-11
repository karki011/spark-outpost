import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GIT_CONTROL_REASON } from '../src/approvals/decide.ts';
import { REAL_CONFIG } from './fake-acp-floor.ts';
import { floorCard, floorRuns } from './floor-support.ts';

const { root, run, userCards } = floorRuns({ workPlace: 'worktree' });

function worktreeOf(repo: string): string {
  const listed = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  });
  const folders = listed
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
  return folders.find((folder) => folder.includes('.spark/worktrees/')) ?? '';
}

describe.each(['auto', 'bypassPermissions', 'acceptEdits'])(
  'the safety floor in %s for a chat that works in its own worktree',
  { timeout: 120_000 },
  (mode) => {
    it('asks with hold-to-confirm before a hook is written in the real git folder', async () => {
      const { asked, usedModes } = await run(mode, '#floorrealhook');
      expect(usedModes).toEqual([mode]);
      expect(worktreeOf(root())).not.toBe('');
      expect(asked.filter(floorCard)).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: GIT_CONTROL_REASON,
          payload: expect.objectContaining({ gitControl: ['.git/hooks/pre-commit'] }),
        }),
      ]);
      expect(existsSync(join(root(), '.git/hooks/pre-commit'))).toBe(false);
    });

    it('asks with hold-to-confirm before git config is rewritten in the real git folder', async () => {
      const before = readFileSync(join(root(), '.git/config'), 'utf8');
      const { asked } = await run(mode, '#floorrealconfig');
      expect(asked.filter(floorCard)).toEqual([
        expect.objectContaining({
          kind: 'edit',
          reason: GIT_CONTROL_REASON,
          payload: expect.objectContaining({ gitControl: ['.git/config'] }),
        }),
      ]);
      const after = readFileSync(join(root(), '.git/config'), 'utf8');
      expect(after).not.toContain(REAL_CONFIG);
      expect(after.includes('[user]')).toBe(before.includes('[user]'));
    });

    it('raises nothing for an ordinary edit in the worktree', async () => {
      const { conversationId, detail, status } = await run(mode, '#floornotes');
      expect(status).toBe('succeeded');
      expect(readFileSync(join(worktreeOf(root()), 'notes.txt'), 'utf8')).toContain('changed\n');
      expect(await userCards(conversationId)).toEqual([]);
      expect(detail.railFlags ?? []).toEqual([]);
    });
  },
);
