import { describe, expect, it } from 'vitest';
import {
  canStart,
  heldBehind,
  heldReason,
  planSettled,
  subChatProgress,
  type PlanPiece,
  type SubChatProgress,
} from './sub-chat-progress.ts';

function piece(id: string, progress: SubChatProgress, waitsFor: string[] = []): PlanPiece {
  return { id, title: id.toUpperCase(), progress, waitsFor };
}

function planOf(...pieces: PlanPiece[]) {
  return new Map(pieces.map((each) => [each.id, each]));
}

describe('how far a sub-chat is', () => {
  const started = { started: true, waiting: false, reported: false, archived: false };

  it('is held until started, working while its task waits, then reported or ended', () => {
    expect(subChatProgress({ ...started, started: false })).toBe('held');
    expect(subChatProgress({ ...started, waiting: true })).toBe('working');
    expect(subChatProgress({ ...started, reported: true })).toBe('reported');
    expect(subChatProgress(started)).toBe('ended');
  });

  it('counts an archived sub-chat as reported, so nothing waits on it forever', () => {
    expect(subChatProgress({ ...started, archived: true })).toBe('reported');
    expect(subChatProgress({ ...started, started: false, archived: true })).toBe('reported');
  });
});

describe('releasing a Held sub-chat', () => {
  it('starts when everything it waits for has reported', () => {
    const docs = piece('docs', 'held', ['api', 'page']);
    expect(canStart(docs, planOf(piece('api', 'reported'), piece('page', 'reported'), docs))).toBe(
      true,
    );
    expect(canStart(docs, planOf(piece('api', 'reported'), piece('page', 'working'), docs))).toBe(
      false,
    );
  });

  it('counts a sub-chat that no longer exists as reported', () => {
    const docs = piece('docs', 'held', ['api', 'gone']);
    expect(canStart(docs, planOf(piece('api', 'reported'), docs))).toBe(true);
  });

  it('stays Held behind one that failed or was stopped, and says so', () => {
    const page = piece('page', 'held', ['api']);
    const plan = planOf(piece('api', 'ended'), page);
    expect(canStart(page, plan)).toBe(false);
    expect(heldBehind(page, plan).map((each) => each.id)).toEqual(['api']);
    expect(heldReason(page, plan)).toBe('Held: “API” did not finish. Start anyway starts it.');
  });

  it('says which of them did not finish and which cannot start', () => {
    const page = piece('page', 'held', ['api']);
    const docs = piece('docs', 'held', ['api', 'page']);
    const plan = planOf(piece('api', 'ended'), page, docs);
    expect(heldReason(docs, plan)).toBe(
      'Held: “API” did not finish and “PAGE” cannot start by itself. Start anyway starts it.',
    );
  });

  it('names what a Held sub-chat still waits for', () => {
    const page = piece('page', 'held', ['api', 'db']);
    const plan = planOf(piece('api', 'working'), piece('db', 'reported'), page);
    expect(heldReason(page, plan)).toBe('Waits for “API”.');
    expect(heldReason(piece('api', 'working'), plan)).toBeNull();
  });

  it('never starts a sub-chat that is already started', () => {
    expect(canStart(piece('api', 'working'), planOf())).toBe(false);
  });
});

describe('when a plan is settled', () => {
  it('is settled when every sub-chat reported, ended, or is Held behind one that ended', () => {
    expect(planSettled([piece('api', 'reported'), piece('page', 'ended')])).toBe(true);
    expect(
      planSettled([
        piece('api', 'ended'),
        piece('page', 'held', ['api']),
        piece('docs', 'held', ['page']),
      ]),
    ).toBe(true);
  });

  it('is not settled while one works or can still start by itself', () => {
    expect(planSettled([piece('api', 'reported'), piece('page', 'working')])).toBe(false);
    expect(planSettled([piece('api', 'reported'), piece('page', 'held', ['api'])])).toBe(false);
    expect(planSettled([])).toBe(false);
  });

  it('does not loop on sub-chats that wait on each other', () => {
    const plan = [piece('a', 'held', ['b']), piece('b', 'held', ['a'])];
    expect(planSettled(plan)).toBe(false);
  });
});
