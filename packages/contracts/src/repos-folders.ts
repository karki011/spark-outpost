import { z } from 'zod';

export const REPOS_FOLDERS_MAX = 20;

export const reposFolderSchema = z.object({
  path: z.string(),
  displayPath: z.string(),
  suggested: z.boolean(),
});
export type ReposFolder = z.infer<typeof reposFolderSchema>;

export const reposFoldersSchema = z.object({
  folders: z.array(reposFolderSchema),
});
export type ReposFolders = z.infer<typeof reposFoldersSchema>;

export const updateReposFoldersRequestSchema = z.object({
  folders: z.array(z.string().trim().min(1).max(4096)).max(REPOS_FOLDERS_MAX),
});
export type UpdateReposFoldersRequest = z.infer<typeof updateReposFoldersRequestSchema>;

export const linkRepoActionSchema = z.object({
  action: z.literal('link_repo'),
  repo: z.string().max(300),
  path: z.string().max(4096),
  displayPath: z.string().max(4096),
  origin: z.string().max(300).nullable(),
  projectId: z.uuid().nullable(),
});
export type LinkRepoAction = z.infer<typeof linkRepoActionSchema>;

export const linkRepoLabels = {
  link_repo: {
    question: 'Link this repository to this chat?',
    confirm: 'Link',
    doing: 'Linking the repository…',
  },
};

export function linkRepoQuestion(action: LinkRepoAction): string {
  return `Link ${action.repo} to this chat?`;
}
