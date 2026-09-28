import { describe, expect, it } from 'vitest';
import type { ChangedFile, TaskChanges } from '@spark-outpost/contracts';
import { SECRET_SKIP_REASON, shipCandidates } from './files.ts';

const RUN_A = '00000000-0000-4000-8000-00000000000a';
const RUN_B = '00000000-0000-4000-8000-00000000000b';

function file(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    change: 'modified',
    added: 1,
    removed: 0,
    oldText: null,
    newText: null,
    shown: 'text',
    ...extra,
  };
}

describe('ship file selection', () => {
  it("takes every file the task's runs changed, including both sides of a rename", () => {
    const changes: TaskChanges = {
      runs: [
        { runId: RUN_A, revertedAt: null, files: [file('src/a.ts'), file('b.md')] },
        {
          runId: RUN_B,
          revertedAt: null,
          files: [file('src/a.ts'), file('src/new.ts', { oldPath: 'src/old.ts' })],
        },
      ],
    };
    expect(shipCandidates(changes)).toEqual({
      paths: ['b.md', 'src/a.ts', 'src/new.ts', 'src/old.ts'],
      skipped: [],
    });
  });

  it('leaves out reverted runs, secrets files and paths outside the folder', () => {
    const changes: TaskChanges = {
      runs: [
        { runId: RUN_A, revertedAt: '2026-09-28T00:00:00.000Z', files: [file('undone.ts')] },
        {
          runId: RUN_B,
          revertedAt: null,
          files: [file('.env'), file('config/.env.local'), file('../x.ts'), file('.env.example')],
        },
      ],
    };
    expect(shipCandidates(changes)).toEqual({
      paths: ['.env.example'],
      skipped: [
        { path: '.env', reason: SECRET_SKIP_REASON },
        { path: 'config/.env.local', reason: SECRET_SKIP_REASON },
      ],
    });
  });
});
