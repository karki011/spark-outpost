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
  projectIds: string[];
}

export function newDraft(seed?: CreateTeammateRequest): TeammateDraft {
  return {
    name: seed?.name ?? '',
    role: seed?.role ?? '',
    face: seed?.face ?? null,
    provider: seed?.provider ?? null,
    model: seed?.model ?? null,
    agentMode: seed?.agentMode ?? null,
    level: seed?.level ?? null,
    instructions: seed?.instructions ?? '',
    projectIds: seed?.projectIds ?? [],
  };
}

export function draftOf(teammate: Teammate): TeammateDraft {
  return {
    name: teammate.name,
    role: teammate.role,
    face: teammate.face,
    provider: teammate.provider,
    model: teammate.model,
    agentMode: teammate.agentMode,
    level: teammate.level,
    instructions: teammate.instructions,
    projectIds: [...teammate.projectIds],
  };
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
    face: shownFace(draft),
    provider: draft.provider,
    model: draft.model,
    agentMode: draft.agentMode,
    level: draft.level,
    instructions: draft.instructions,
    projectIds: draft.projectIds,
  };
}

const SCALAR_FIELDS = [
  'name',
  'role',
  'provider',
  'model',
  'agentMode',
  'level',
  'instructions',
] as const;

export function changesFrom(teammate: Teammate, draft: TeammateDraft): UpdateTeammateRequest {
  const changes: Record<string, unknown> = {};
  for (const field of SCALAR_FIELDS) {
    const value = typeof draft[field] === 'string' ? (draft[field] as string).trim() : draft[field];
    if (value !== teammate[field]) changes[field] = value;
  }
  const face = shownFace(draft);
  if (face.shape !== teammate.face.shape || face.color !== teammate.face.color) {
    changes.face = face;
  }
  if (draft.projectIds.join() !== teammate.projectIds.join()) changes.projectIds = draft.projectIds;
  return changes as UpdateTeammateRequest;
}
