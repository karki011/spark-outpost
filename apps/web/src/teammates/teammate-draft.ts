import {
  TEAMMATE_INSTRUCTIONS_MAX,
  createTeammateRequestSchema,
  faceFromName,
  type CreateTeammateRequest,
  type Teammate,
  type TeammateFace,
  type UpdateTeammateRequest,
} from '@spark-outpost/contracts';
import type { DefaultsDraft } from './TeammateDefaults.tsx';

export interface TeammateDraft extends DefaultsDraft {
  name: string;
  role: string;
  face: TeammateFace | null;
  instructions: string;
  instructionsPath: string | null;
  projectIds: string[];
}

export function newDraft(seed?: CreateTeammateRequest): TeammateDraft {
  return {
    name: seed?.name ?? '',
    role: seed?.role ?? '',
    face: seed?.face ?? null,
    provider: seed?.provider ?? null,
    model: seed?.model ?? null,
    effort: seed?.effort ?? null,
    agentMode: seed?.agentMode ?? null,
    level: seed?.level ?? null,
    instructions: seed?.instructions ?? '',
    instructionsPath: seed?.instructionsPath ?? null,
    projectIds: seed?.projectIds ?? [],
  };
}

export function draftOf(teammate: Teammate): TeammateDraft {
  return {
    name: teammate.name,
    role: teammate.role,
    face: pickedFace(teammate),
    provider: teammate.provider,
    model: teammate.model,
    effort: teammate.effort,
    agentMode: teammate.agentMode,
    level: teammate.level,
    instructions: teammate.instructions,
    instructionsPath: teammate.instructionsPath,
    projectIds: [...teammate.projectIds],
  };
}

function pickedFace(teammate: Teammate): TeammateFace | null {
  return teammate.faceAuto ? null : teammate.face;
}

export function shownFace(draft: TeammateDraft): TeammateFace {
  return draft.face ?? faceFromName(draft.name || 'Spark');
}

export function draftProblem(draft: TeammateDraft): string | null {
  if (draft.instructions.trim().length > TEAMMATE_INSTRUCTIONS_MAX) {
    return `Keep standing instructions to ${TEAMMATE_INSTRUCTIONS_MAX} characters.`;
  }
  const parsed = createTeammateRequestSchema.safeParse(createRequest(draft));
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check the details.');
}

export function createRequest(draft: TeammateDraft): CreateTeammateRequest {
  return {
    name: draft.name,
    role: draft.role,
    face: draft.face,
    provider: draft.provider,
    model: draft.model,
    effort: draft.effort,
    agentMode: draft.agentMode,
    level: draft.level,
    instructions: draft.instructions,
    instructionsPath: draft.instructionsPath,
    projectIds: draft.projectIds,
  };
}

const SCALAR_FIELDS = [
  'name',
  'role',
  'provider',
  'model',
  'effort',
  'agentMode',
  'level',
  'instructions',
  'instructionsPath',
] as const;

export function changesFrom(teammate: Teammate, draft: TeammateDraft): UpdateTeammateRequest {
  const changes: Record<string, unknown> = {};
  for (const field of SCALAR_FIELDS) {
    const value = typeof draft[field] === 'string' ? (draft[field] as string).trim() : draft[field];
    if (value !== teammate[field]) changes[field] = value;
  }
  if (JSON.stringify(draft.face) !== JSON.stringify(pickedFace(teammate))) {
    changes.face = draft.face;
  }
  if (draft.projectIds.join() !== teammate.projectIds.join()) changes.projectIds = draft.projectIds;
  return changes as UpdateTeammateRequest;
}
