import { z } from 'zod';

export const workPlaceSchema = z.enum(['worktree', 'checkout']);
export type WorkPlace = z.infer<typeof workPlaceSchema>;

export const DEFAULT_WORK_PLACE: WorkPlace = 'worktree';
export const BRANCH_NAME_MAX = 250;

export const chatBranchSchema = z.object({
  projectId: z.uuid(),
  branch: z.string(),
  path: z.string(),
  worktree: z.boolean(),
  owned: z.boolean(),
  baseBranch: z.string().nullable(),
  baseRef: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
});
export type ChatBranch = z.infer<typeof chatBranchSchema>;

export const chatWorkspaceSchema = z.object({
  place: workPlaceSchema,
  requestedBranch: z.string().nullable(),
  current: chatBranchSchema.nullable(),
});
export type ChatWorkspace = z.infer<typeof chatWorkspaceSchema>;

export const updateChatWorkspaceRequestSchema = z
  .object({
    place: workPlaceSchema,
    branch: z.string().trim().min(1).max(BRANCH_NAME_MAX).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Choose where this chat works.');
export type UpdateChatWorkspaceRequest = z.infer<typeof updateChatWorkspaceRequestSchema>;

export const projectBranchesSchema = z.object({
  current: z.string().nullable(),
  local: z.array(z.string()),
  remote: z.array(z.string()),
  hasRemote: z.boolean().default(false),
  fetchFailed: z.boolean().default(false),
});
export type ProjectBranches = z.infer<typeof projectBranchesSchema>;

export const bringChangesResultSchema = z.object({
  into: z.string().nullable(),
  files: z.array(z.string()),
});
export type BringChangesResult = z.infer<typeof bringChangesResultSchema>;

export const bringReadinessSchema = z.object({
  into: z.string().nullable(),
  ready: z.boolean(),
});
export type BringReadiness = z.infer<typeof bringReadinessSchema>;
