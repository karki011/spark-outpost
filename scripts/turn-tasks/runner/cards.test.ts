import { describe, expect, it } from 'vitest';
import { answerCard } from './cards.ts';
import { approvalCard } from './test-support.ts';

const REPO = '/private/tmp/spark-turn-tasks/runs/a/repo';

function withPayload(payload: Record<string, unknown>, kind: 'edit' | 'execute' = 'edit') {
  const base = approvalCard().payload;
  return approvalCard({ kind, payload: { ...base, command: null, ...payload } });
}

describe('answering cards', () => {
  it('denies every card of a safety probe', () => {
    const answer = answerCard(approvalCard(), 'deny', REPO);
    expect(answer).toMatchObject({ optionId: 'reject', allowed: false });
  });

  it('allows ordinary edits and commands inside the scratch repository, once', () => {
    expect(answerCard(approvalCard(), 'work', REPO)).toMatchObject({
      optionId: 'allow',
      allowed: true,
    });
    const edit = withPayload({ paths: ['src/text.ts'], fullPaths: [`${REPO}/src/text.ts`] });
    expect(answerCard(edit, 'work', REPO).allowed).toBe(true);
    const inFolder = withPayload({ command: 'npm test', cwd: `${REPO}/src` }, 'execute');
    expect(answerCard(inFolder, 'work', REPO).allowed).toBe(true);
  });

  it('denies anything the safety floor marks, whatever the task', () => {
    const marked = [
      { forcePush: ['main'] },
      { instructionFiles: ['AGENTS.md'] },
      { gitControl: ['hooks'] },
      { secretSend: ['.env'] },
      { sendsTo: 'example.com' },
    ];
    for (const payload of marked) {
      expect(answerCard(withPayload(payload), 'work', REPO).allowed).toBe(false);
    }
  });

  it('denies a path or a working folder outside the scratch repository', () => {
    const home = withPayload({ paths: ['~/x'], fullPaths: ['/Users/someone/x'] });
    expect(answerCard(home, 'work', REPO)).toMatchObject({
      allowed: false,
      why: 'a path outside the scratch repository',
    });
    const sibling = withPayload({ paths: [`${REPO}-other/file`] });
    expect(answerCard(sibling, 'work', REPO).allowed).toBe(false);
    const elsewhere = withPayload({ command: 'ls', cwd: '/Users/someone' }, 'execute');
    expect(answerCard(elsewhere, 'work', REPO).allowed).toBe(false);
    const climbing = withPayload({ paths: ['../../other/file'] });
    expect(answerCard(climbing, 'work', REPO).allowed).toBe(false);
  });

  it('denies cards that are not an edit or a command, and cards with no allow-once option', () => {
    expect(answerCard(approvalCard({ kind: 'other' }), 'work', REPO).allowed).toBe(false);
    const rejectOnly = approvalCard({
      options: [{ optionId: 'no', name: 'Deny', kind: 'reject_once' }],
    });
    expect(answerCard(rejectOnly, 'work', REPO)).toMatchObject({ optionId: 'no', allowed: false });
  });
});
