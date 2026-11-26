import { z } from 'zod';

export const saveMapNoteActionSchema = z.object({
  action: z.literal('save_map_note'),
  projectId: z.string(),
  project: z.string(),
  areaId: z.string(),
  area: z.string(),
  text: z.string(),
  sources: z.array(
    z.object({ path: z.string(), startLine: z.number().int(), endLine: z.number().int() }),
  ),
});
