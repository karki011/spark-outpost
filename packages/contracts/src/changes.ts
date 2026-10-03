import { z } from 'zod';
import { runChangeSchema } from './approvals.ts';
import { coreImpactSchema } from './map.ts';

export const DIFF_HUGE_BYTES = 1024 * 1024;
export const DIFF_MAX_BYTES = 16 * 1024 * 1024;
export const DIFF_FIRST_LINES = 2000;
const CHANGE_PAGE_MAX = 500;

export const changedFileSchema = runChangeSchema.extend({
  added: z.number().int().nonnegative().nullable(),
  removed: z.number().int().nonnegative().nullable(),
  oldText: z.string().nullable(),
  newText: z.string().nullable(),
  shown: z.enum(['text', 'binary', 'too-large']),
  oldPath: z.string().optional(),
  truncated: z.boolean().optional(),
  bytes: z.number().int().nonnegative().optional(),
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

export const taskChangesSchema = z.object({
  runs: z.array(runFileChangesSchema),
  core: coreImpactSchema.nullable().optional(),
});
export type TaskChanges = z.infer<typeof taskChangesSchema>;

export const changeEntrySchema = changedFileSchema
  .omit({ oldText: true, newText: true })
  .extend({ runId: z.uuid() });
export type ChangeEntry = z.infer<typeof changeEntrySchema>;

export const changeRunSummarySchema = z.object({
  runId: z.uuid(),
  revertedAt: z.string().nullable(),
  name: z.string().optional(),
  copy: z.string().optional(),
  files: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});
export type ChangeRunSummary = z.infer<typeof changeRunSummarySchema>;

export const changeSummarySchema = z.object({
  version: z.string(),
  files: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  runs: z.array(changeRunSummarySchema),
  top: z.array(changeEntrySchema),
  core: coreImpactSchema.nullable().optional(),
});
export type ChangeSummary = z.infer<typeof changeSummarySchema>;

export const changeFolderSchema = z.object({
  path: z.string(),
  start: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});
export type ChangeFolder = z.infer<typeof changeFolderSchema>;

export const changePageQuerySchema = z.object({
  version: z.string().max(64).optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(CHANGE_PAGE_MAX).default(200),
  q: z.string().max(512).optional(),
  runs: z.string().max(4096).optional(),
});

export const changePageSchema = z.object({
  version: z.string(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  files: z.array(changeEntrySchema),
  folders: z.array(changeFolderSchema),
});
export type ChangePage = z.infer<typeof changePageSchema>;

export const changeDiffQuerySchema = z.object({
  runId: z.uuid(),
  path: z.string().min(1).max(4096),
  version: z.string().max(64).optional(),
  lines: z.coerce.number().int().positive().optional(),
});

export const changeDiffSchema = changeEntrySchema.extend({
  oldText: z.string().nullable(),
  newText: z.string().nullable(),
  oldLines: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  limited: z.boolean(),
});
export type ChangeDiff = z.infer<typeof changeDiffSchema>;
