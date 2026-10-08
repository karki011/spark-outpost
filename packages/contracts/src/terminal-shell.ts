import { z } from 'zod';

export const shellFolderKindSchema = z.enum(['worktree', 'project', 'home']);
export type ShellFolderKind = z.infer<typeof shellFolderKindSchema>;

export const createShellResponseSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  cwd: z.string(),
  label: z.string(),
  kind: shellFolderKindSchema,
  note: z.string().nullable(),
});
export type CreateShellResponse = z.infer<typeof createShellResponseSchema>;
