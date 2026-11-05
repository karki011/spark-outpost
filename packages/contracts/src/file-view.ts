import { z } from 'zod';

export const FILE_FOCUS_ACTIVITY = 'file_focus';
export const FILE_VIEW_LINES = 40;
export const FILE_VIEW_LINE_CHARS = 240;

export const fileFocusSchema = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().positive().nullable(),
  limit: z.number().int().positive().nullable(),
  action: z.enum(['read', 'edit']),
});
export type FileFocus = z.infer<typeof fileFocusSchema>;

export const fileViewSchema = z.object({
  runId: z.uuid(),
  action: fileFocusSchema.shape.action,
  name: z.string(),
  path: z.string(),
  firstLine: z.number().int().positive(),
  lines: z.array(z.string()),
  totalLines: z.number().int().nonnegative(),
  focus: z
    .object({ from: z.number().int().positive(), to: z.number().int().positive() })
    .nullable(),
});
export type FileView = z.infer<typeof fileViewSchema>;

export const fileViewResponseSchema = z.object({
  view: fileViewSchema.nullable(),
  refused: z.string().nullable(),
});
export type FileViewResponse = z.infer<typeof fileViewResponseSchema>;
