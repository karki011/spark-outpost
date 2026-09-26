import { z } from 'zod';
import { runChangeSchema } from './approvals.ts';

export const CHANGED_FILE_TEXT_MAX_BYTES = 256 * 1024;
export const CHANGED_FILE_FULL_MAX_BYTES = 4 * 1024 * 1024;

export const changedFileSchema = runChangeSchema.extend({
  added: z.number().int().nonnegative().nullable(),
  removed: z.number().int().nonnegative().nullable(),
  oldText: z.string().nullable(),
  newText: z.string().nullable(),
  shown: z.enum(['text', 'binary', 'too-large']),
  oldPath: z.string().optional(),
  truncated: z.boolean().optional(),
});
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const runFileChangesSchema = z.object({
  runId: z.uuid(),
  revertedAt: z.string().nullable(),
  files: z.array(changedFileSchema),
  name: z.string().optional(),
  copy: z.string().optional(),
});
export type RunFileChanges = z.infer<typeof runFileChangesSchema>;

export const taskChangesSchema = z.object({ runs: z.array(runFileChangesSchema) });
export type TaskChanges = z.infer<typeof taskChangesSchema>;

export const changedFileQuerySchema = z.object({
  runId: z.uuid(),
  path: z.string().min(1).max(4096),
});
export type ChangedFileQuery = z.infer<typeof changedFileQuerySchema>;
