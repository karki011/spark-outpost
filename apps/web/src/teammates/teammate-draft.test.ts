import { describe, expect, it } from 'vitest';
import { TEAMMATE_INSTRUCTIONS_MAX, faceFromName, type Teammate } from '@spark-outpost/contracts';
import {
  changesFrom,
  createRequest,
  draftOf,
  draftProblem,
  newDraft,
  shownFace,
} from './teammate-draft.ts';

const teammate: Teammate = {
  id: '0190a0a0-0000-7000-8000-000000000001',
  name: 'Pip',
  role: 'Code reviewer',
  face: { shape: 'round', color: 'sky' },
  faceAuto: false,
  provider: null,
  model: null,
  effort: null,
  agentMode: null,
  level: null,
  instructions: 'Be brief.',
  instructionsPath: null,
  projectIds: [],
  homeConversationId: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('teammate draft', () => {
  it('shows the face from the name and stores none until the user picks one', () => {
    const draft = { ...newDraft(), name: 'Wren' };
    expect(shownFace(draft)).toEqual(faceFromName('Wren'));
    expect(shownFace({ ...draft, name: 'Wrena' })).toEqual(faceFromName('Wrena'));
    expect(createRequest(draft).face).toBeNull();
    expect(createRequest({ ...draft, face: { shape: 'sun', color: 'gold' } }).face).toEqual({
      shape: 'sun',
      color: 'gold',
    });
  });

  it('keeps a picked look when editing and sends null to go back to the name', () => {
    expect(draftOf(teammate).face).toEqual({ shape: 'round', color: 'sky' });
    expect(changesFrom(teammate, { ...draftOf(teammate), face: null })).toEqual({ face: null });
    const auto = { ...teammate, faceAuto: true, face: faceFromName('Pip') };
    expect(draftOf(auto).face).toBeNull();
    expect(changesFrom(auto, draftOf(auto))).toEqual({});
    expect(changesFrom(auto, { ...draftOf(auto), face: faceFromName('Pip') })).toEqual({
      face: faceFromName('Pip'),
    });
  });

  it('sends an instructions file only when it changes', () => {
    const path = '/Users/me/roles/reviewer.md';
    expect(changesFrom(teammate, { ...draftOf(teammate), instructionsPath: path })).toEqual({
      instructionsPath: path,
    });
    const withFile = { ...teammate, instructionsPath: path };
    expect(changesFrom(withFile, { ...draftOf(withFile), instructionsPath: null })).toEqual({
      instructionsPath: null,
    });
  });

  it('flags a missing name, and takes instructions longer than the old limit', () => {
    expect(draftProblem(newDraft())).toBe('Give your Spark a name.');
    const long = {
      ...newDraft(),
      name: 'Pip',
      instructions: 'x'.repeat(TEAMMATE_INSTRUCTIONS_MAX + 1),
    };
    expect(draftProblem(long)).toBeNull();
    expect(draftProblem({ ...newDraft(), name: 'Pip' })).toBeNull();
  });

  it('sends only what changed when editing', () => {
    const draft = { ...draftOf(teammate), role: 'Reviewer ', level: 'full-auto' as const };
    expect(changesFrom(teammate, draft)).toEqual({ role: 'Reviewer', level: 'full-auto' });
    expect(changesFrom(teammate, draftOf(teammate))).toEqual({});
  });
});
