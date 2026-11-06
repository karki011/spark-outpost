import { z } from 'zod';

export const GITHUB_REPO_SLUG = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

const slugSchema = z.string().regex(GITHUB_REPO_SLUG);

export const githubReadActionSchema = z.object({
  action: z.literal('github_read'),
  repo: slugSchema.nullable(),
  what: z.string().max(300),
});
export type GitHubReadAction = z.infer<typeof githubReadActionSchema>;

export const cloneRepoActionSchema = z.object({
  action: z.literal('clone_repo'),
  repo: slugSchema,
  url: z.string().max(2000),
  parentPath: z.string().max(4096),
  name: z.string().max(255),
  displayPath: z.string().max(4096),
  sizeKb: z.number().int().nonnegative().nullable(),
});
export type CloneRepoAction = z.infer<typeof cloneRepoActionSchema>;

export const githubRepoLabels = {
  github_read: {
    question: 'Let the agent read GitHub?',
    confirm: 'Allow',
    doing: 'Allowing GitHub…',
  },
  clone_repo: {
    question: 'Clone and link this repository?',
    confirm: 'Clone and link',
    doing: 'Cloning the repository…',
  },
};

export function githubReadQuestion(action: GitHubReadAction): string {
  return action.repo
    ? `Let the agent copy ${action.repo} to read it?`
    : 'Let the agent search your GitHub repositories?';
}

export function cloneRepoQuestion(action: CloneRepoAction): string {
  return `Clone and link ${action.repo}?`;
}

export function repoSizeText(sizeKb: number): string {
  if (sizeKb < 1024) return `${sizeKb} KB`;
  const mb = sizeKb / 1024;
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(1)} GB`;
}
