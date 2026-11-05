import { describe, expect, it } from 'vitest';
import { auditContinuedSession, interruptionNote } from './continue-note.ts';

const facts = {
  request: 'Add an export button to the report page.',
  stoppedAt: new Date('2026-10-05T09:30:00Z'),
  lastStep: { name: 'pnpm test', finished: false },
  files: ['src/report.tsx', 'src/export.ts'],
  waitingFor: [],
};

describe('interruptionNote', () => {
  it('gives the original request, the last step, the changed files and the cautions', () => {
    const note = interruptionNote(facts);
    expect(note).toContain('## Your previous turn was interrupted');
    expect(note).toContain('Original request:\nAdd an export button to the report page.');
    expect(note).toContain('"pnpm test", which had started and may not have finished.');
    expect(note).toContain('Files changed so far: `src/report.tsx`, `src/export.ts`.');
    expect(note).toContain('Do not rerun commands blindly');
    expect(note).toContain('check the remote state first');
    expect(note).toContain('Nothing was retried automatically.');
    expect(note).not.toContain('waiting for approval of');
  });

  it('says when the last step had finished and when nothing changed', () => {
    const note = interruptionNote({
      ...facts,
      lastStep: { name: 'Read notes.txt', finished: true },
      files: [],
    });
    expect(note).toContain('"Read notes.txt", which had finished.');
    expect(note).toContain('Files changed so far: none that Spark could see.');
    expect(interruptionNote({ ...facts, lastStep: null })).toContain('none was recorded');
  });

  it('names what was waiting for approval and says it is not approved', () => {
    const note = interruptionNote({ ...facts, waitingFor: ['git push origin spark/export'] });
    expect(note).toContain(
      'It was waiting for approval of "git push origin spark/export". That never ran and is not approved.',
    );
  });

  it('shortens a long file list', () => {
    const files = Array.from({ length: 25 }, (_, index) => `f${index}.ts`);
    expect(interruptionNote({ ...facts, files })).toContain('`f19.ts`, and 5 more.');
  });
});

describe('auditContinuedSession', () => {
  const output = {
    kind: 'session' as const,
    sessionId: 's-1',
    cwd: '/work/app',
    additionalDirectories: [],
    continued: true,
    freshReason: null as string | null,
  };
  const target = { workdir: null, resume: null, freshReason: null, interrupted: true };

  function recorded(
    input: { continuesRunId: string | null },
    session: typeof target | undefined,
    result = output,
  ) {
    const messages: unknown[] = [];
    auditContinuedSession(
      { message: (_direction, message) => void messages.push(message) },
      input,
      session,
      result,
    );
    return messages;
  }

  it('records that the user asked and whether the interrupted session was reopened', () => {
    expect(recorded({ continuesRunId: 'run-1' }, target)).toEqual([
      {
        method: 'interruption/session',
        params: {
          continues: 'run-1',
          requestedBy: 'user',
          decision: 'reopened the interrupted session',
          reason: null,
          sessionId: 's-1',
        },
      },
    ]);
    const fresh = { ...output, continued: false, freshReason: "couldn't resume" };
    expect(recorded({ continuesRunId: 'run-1' }, target, fresh)).toMatchObject([
      { params: { decision: 'fresh session', reason: "couldn't resume" } },
    ]);
  });

  it('records nothing for an ordinary turn', () => {
    expect(recorded({ continuesRunId: null }, target)).toEqual([]);
    expect(recorded({ continuesRunId: 'run-1' }, { ...target, interrupted: false })).toEqual([]);
  });
});
