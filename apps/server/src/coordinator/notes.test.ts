import { describe, expect, it } from 'vitest';
import type { TaskPiece } from '@spark-outpost/contracts';
import type { StoredNote } from '../persistence/piece-notes.ts';
import {
  contractSymbols,
  importsAny,
  landingNotices,
  noteSection,
  touchedSymbols,
} from './notes.ts';

function piece(key: string, extra: Partial<TaskPiece> = {}): TaskPiece {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    key,
    title: `Piece ${key}`,
    goal: 'Goal',
    owns: [`${key}.ts`],
    reads: [],
    dependsOn: [],
    contract: null,
    contractVersion: 1,
    acceptance: [],
    checks: [],
    research: false,
    sizeEstimate: 20_000,
    placement: 'worktree',
    provider: 'claude',
    model: 'sonnet',
    builderRunId: null,
    builderName: null,
    status: 'running',
    attempts: 1,
    fixTurns: 0,
    filesChanged: [],
    violations: [],
    check: null,
    costUsd: null,
    landedAt: null,
    note: null,
    notesQueued: 0,
    pickNote: null,
    ...extra,
  };
}

const PATCH = [
  'diff --git a/tags.ts b/tags.ts',
  '--- a/tags.ts',
  '+++ b/tags.ts',
  '-export function listTags(db) {',
  '+export function listTags(db, projectId) {',
].join('\n');

const landed = {
  piece: {
    key: 'P1',
    title: 'Tags API',
    filesChanged: ['src/tags.ts'],
    contract: 'listTags(db, projectId): Promise<string[]>',
  },
  builder: 'Bolt',
  patch: PATCH,
};

function note(kind: StoredNote['kind'], body: string): StoredNote {
  return { id: 'n', pieceId: 'p', kind, body, source: 'user', urgent: false };
}

describe('piece notes', () => {
  it('heads boundary notes for the Builder and leaves control notes out', () => {
    const text = noteSection([
      note('requirement_added', 'return JSON'),
      note('skip', 'skip it'),
      note('steer', 'use UTC'),
    ]);
    expect(text).toContain('## Note from the coordinator');
    expect(text).toContain('- Added requirement: return JSON\n- From the user: use UTC');
    expect(text).not.toContain('skip it');
    expect(noteSection([note('reassign', 'codex')])).toBeNull();
  });

  it('names the symbols a contract gives and finds the ones a diff changed', () => {
    expect(contractSymbols('listTags(db): string[]; uses `store.setTags`')).toEqual([
      'listTags',
      'setTags',
    ]);
    expect(touchedSymbols(['listTags', 'setTags', 'list'], PATCH)).toEqual(['listTags']);
  });

  it('sees imports of a landed file by its name', () => {
    expect(importsAny(["import { listTags } from '../src/tags.ts';"], ['src/tags.ts'])).toBe(true);
    expect(importsAny(["const tags = require('./tags')"], ['src/tags.ts'])).toBe(true);
    expect(importsAny(["import { x } from './tagsList';"], ['src/tags.ts'])).toBe(false);
  });

  it('flags changed contracts to the running pieces that use the landed piece', () => {
    const notices = landingNotices(landed, [
      { piece: piece('P2', { dependsOn: ['P1'] }), sources: [] },
      {
        piece: piece('P3', { placement: 'shared' }),
        sources: ["import { listTags } from './tags.ts';"],
      },
      { piece: piece('P4', { contract: 'The view calls `listTags`' }), sources: [] },
      { piece: piece('P5'), sources: [] },
    ]);
    expect(notices.map((notice) => [notice.pieceKey, notice.kind, notice.urgent])).toEqual([
      ['P2', 'contract_changed', false],
      ['P3', 'contract_changed', true],
      ['P4', 'contract_changed', false],
    ]);
    expect(notices[0]!.body).toContain('changed `listTags`');
  });
});
