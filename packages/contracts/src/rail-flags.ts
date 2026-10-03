import { z } from 'zod';

export const railKindSchema = z.enum([
  'outside_write',
  'outside_delete',
  'secret',
  'force_push',
  'git_control',
  'instructions',
]);
export type RailKind = z.infer<typeof railKindSchema>;

export const railFlagStatusSchema = z.enum(['open', 'dismissed', 'reverted']);
export type RailFlagStatus = z.infer<typeof railFlagStatusSchema>;

export const railOriginalSchema = z.object({ path: z.string(), text: z.string() });
export type RailOriginal = z.infer<typeof railOriginalSchema>;

export const railFlagSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  turnRunId: z.uuid(),
  rail: railKindSchema,
  title: z.string(),
  paths: z.array(z.string()),
  inside: z.boolean(),
  originals: z.array(railOriginalSchema),
  status: railFlagStatusSchema,
  createdAt: z.string(),
});
export type RailFlag = z.infer<typeof railFlagSchema>;

export const railFlagDecisionSchema = z.object({ action: z.enum(['dismiss', 'revert']) });
export type RailFlagDecision = z.infer<typeof railFlagDecisionSchema>;

export const RAIL_FLAGGED = 'rail_flagged';

const RAIL_VERBS: Record<RailKind, string> = {
  outside_write: 'wrote outside the project',
  outside_delete: 'deleted outside the project',
  secret: 'touched a secret file',
  force_push: 'force-pushed',
  git_control: 'changed git hooks or config',
  instructions: 'changed agent instructions',
};

const SHOWN_PATHS = 3;

export function railFlagTitle(agent: string, rail: RailKind, paths: readonly string[]): string {
  const verb = `${agent} ${RAIL_VERBS[rail]}`;
  if (paths.length === 0) return verb;
  const shown = paths.slice(0, SHOWN_PATHS).join(', ');
  const more = paths.length > SHOWN_PATHS ? ` and ${paths.length - SHOWN_PATHS} more` : '';
  return `${verb}: ${shown}${more}`;
}
