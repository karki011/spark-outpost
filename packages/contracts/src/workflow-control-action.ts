import { z } from 'zod';
import { crewSlugSchema } from './crew-files.ts';
import { workflowScheduleSchema } from './crew-schedule.ts';
import { workflowTriggersSchema } from './crew-triggers.ts';

export const workflowControlOpSchema = z.enum([
  'run',
  'stop',
  'schedule',
  'unschedule',
  'triggers',
]);
export type WorkflowControlOp = z.infer<typeof workflowControlOpSchema>;

export const workflowControlActionSchema = z.object({
  action: z.literal('workflow_control'),
  op: workflowControlOpSchema,
  workflowId: crewSlugSchema,
  name: z.string().max(100),
  message: z.string().max(4000).default(''),
  project: z
    .object({ id: z.uuid(), name: z.string().max(200) })
    .nullable()
    .default(null),
  messageId: z.uuid().optional(),
  workflowRunId: z.uuid().optional(),
  schedule: workflowScheduleSchema.optional(),
  triggers: workflowTriggersSchema.optional(),
});
export type WorkflowControlAction = z.infer<typeof workflowControlActionSchema>;

export const workflowControlLabels = {
  workflow_control: {
    question: 'Change this workflow?',
    confirm: 'Allow',
    doing: 'Working on the workflow…',
  },
};

export function workflowControlQuestion(action: WorkflowControlAction): string {
  const { name } = action;
  switch (action.op) {
    case 'run':
      return `Run the ${name} workflow?`;
    case 'stop':
      return `Stop the ${name} workflow run?`;
    case 'schedule':
      return `Schedule the ${name} workflow?`;
    case 'unschedule':
      return `Turn off the ${name} workflow’s schedule?`;
    case 'triggers':
      return `Change the ${name} workflow’s triggers?`;
  }
}
