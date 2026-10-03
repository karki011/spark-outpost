import { describe, expect, it } from 'vitest';
import { TEAMMATE_INSTRUCTIONS_MAX, faceFromName, type Teammate } from '@spark-outpost/contracts';
import { changesFrom, createRequest, draftOf, draftProblem, newDraft } from './teammate-draft.ts';

const teammate: Teammate = {
  id: '0190a0a0-0000-7000-8000-000000000001',
  name: 'Pip',
  role: 'Code reviewer',
  face: { shape: 'round', color: 'sky' },
  provider: null,
  model: null,
  agentMode: null,
  level: null,
  instructions: 'Be brief.',
  projectIds: [],
  homeConversationId: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

describe('teammate draft', () => {
  it('follows the name for the face until the user picks one', () => {
    const draft = { ...newDraft(), name: 'Wren' };
    expect(createRequest(draft).face).toEqual(faceFromName('Wren'));
    expect(createRequest({ ...draft, face: { shape: 'sun', color: 'gold' } }).face).toEqual({
      shape: 'sun',
      color: 'gold',
    });
  });

  it('flags a missing name and instructions over the limit', () => {
    expect(draftProblem(newDraft())).toBe('Give your Spark a name.');
    const long = {
      ...newDraft(),
      name: 'Pip',
      instructions: 'x'.repeat(TEAMMATE_INSTRUCTIONS_MAX + 1),
    };
    expect(draftProblem(long)).toContain(String(TEAMMATE_INSTRUCTIONS_MAX));
    expect(draftProblem({ ...newDraft(), name: 'Pip' })).toBeNull();
  });

  it('sends only what changed when editing', () => {
    const draft = { ...draftOf(teammate), role: 'Reviewer ', level: 'full-auto' as const };
    expect(changesFrom(teammate, draft)).toEqual({ role: 'Reviewer', level: 'full-auto' });
    expect(changesFrom(teammate, draftOf(teammate))).toEqual({});
  });
});
