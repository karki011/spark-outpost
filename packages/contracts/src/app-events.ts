import { z } from 'zod';

export const appEventKindSchema = z.enum([
  'conversation',
  'run',
  'step',
  'subagent',
  'approval',
  'orchestration',
  'task',
  'digest',
  'outcome',
  'map',
  'pull_request',
  'teammate',
  'ticket',
  'preview',
  'outpost_changed',
  'agent_terminal',
]);
export type AppEventKind = z.infer<typeof appEventKindSchema>;

export const appEventSchema = z.object({
  kind: appEventKindSchema,
  conversationId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  mapId: z.uuid().optional(),
  outpostId: z.uuid().optional(),
});
export type AppEvent = z.infer<typeof appEventSchema>;

export function parseAppEvent(raw: string): AppEvent | null {
  try {
    const parsed = appEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
