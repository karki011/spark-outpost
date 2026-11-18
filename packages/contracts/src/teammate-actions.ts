import { z } from 'zod';
import { crewSimilarSchema } from './crew-edit.ts';
import { involvementLevelSchema } from './involvement-levels.ts';
import { providerIdSchema } from './provider-ids.ts';
import {
  teammateFaceSchema,
  teammateInstructionsSchema,
  teammateNameSchema,
  teammateRoleSchema,
} from './teammates.ts';

const teammateFieldsShape = {
  name: teammateNameSchema,
  role: teammateRoleSchema,
  face: teammateFaceSchema,
  faceAuto: z.boolean().default(false),
  provider: providerIdSchema.nullable(),
  model: z.string().nullable(),
  agentMode: z.string().nullable(),
  level: involvementLevelSchema.nullable(),
  instructions: teammateInstructionsSchema,
  projects: z.array(z.object({ id: z.uuid(), name: z.string() })).max(8),
};

export const createTeammateActionSchema = z.object({
  action: z.literal('create_teammate'),
  ...teammateFieldsShape,
  similar: z.array(crewSimilarSchema).max(8).optional(),
});

export const updateTeammateActionSchema = z.object({
  action: z.literal('update_teammate'),
  teammateId: z.uuid(),
  ...teammateFieldsShape,
  changed: z.array(z.string()).max(20),
  instructionsBefore: z.string().optional(),
});

export const deleteTeammateActionSchema = z.object({
  action: z.literal('delete_teammate'),
  teammateId: z.uuid(),
  name: teammateNameSchema,
  role: teammateRoleSchema,
  face: teammateFaceSchema,
});

export const teammateActionLabels = {
  create_teammate: {
    question: 'Add this Spark?',
    confirm: 'Add Spark',
    doing: 'Adding the Spark…',
  },
  update_teammate: {
    question: 'Change this Spark?',
    confirm: 'Save changes',
    doing: 'Saving the Spark…',
  },
  delete_teammate: {
    question: 'Delete this Spark?',
    confirm: 'Delete',
    doing: 'Deleting the Spark…',
  },
};

const VERBS = { create_teammate: 'Add', update_teammate: 'Change', delete_teammate: 'Delete' };

export function teammateActionQuestion(action: { action: string; name?: unknown }): string | null {
  if (!(action.action in VERBS) || typeof action.name !== 'string') return null;
  return `${VERBS[action.action as keyof typeof VERBS]} the ${action.name} Spark?`;
}
