import { z } from 'zod';
import { taskLinkSchema } from './tasks.ts';

export const GIT_INSTALL_HINT =
  'Git is not installed. Install Apple’s command line tools by running `xcode-select --install` in Terminal, then try again.';

export const SHIP_TITLE_MAX_LENGTH = 200;

export const shipModeSchema = z.enum(['commit', 'push', 'draft_pr']);
export type ShipMode = z.infer<typeof shipModeSchema>;

export const githubMethodSchema = z.enum(['gh_cli', 'token', 'app']);
export type GitHubMethod = z.infer<typeof githubMethodSchema>;

export const shipFileSchema = z.object({
  path: z.string(),
  change: z.enum(['added', 'modified', 'deleted']),
});
export type ShipFile = z.infer<typeof shipFileSchema>;

export const shipSkippedFileSchema = z.object({ path: z.string(), reason: z.string() });
export type ShipSkippedFile = z.infer<typeof shipSkippedFileSchema>;

export const shipPullRequestSchema = z.object({
  url: z.string(),
  number: z.number().int().positive(),
});
export type ShipPullRequest = z.infer<typeof shipPullRequestSchema>;

export const shipRemoteSchema = z.object({
  name: z.string(),
  host: z.string().nullable(),
  repo: z.string().nullable(),
  github: z.boolean(),
});
export type ShipRemote = z.infer<typeof shipRemoteSchema>;

export const shipStateSchema = z.object({
  branch: z.string(),
  commit: z.string().nullable(),
  pushedAt: z.string().nullable(),
  pullRequest: shipPullRequestSchema.nullable(),
});
export type ShipState = z.infer<typeof shipStateSchema>;

export const shipBlockReasonSchema = z.enum([
  'git_missing',
  'running',
  'no_changes',
  'several_folders',
  'unmerged_copy',
  'not_repo',
  'no_commits',
  'nothing_new',
  'switch_branch',
]);
export type ShipBlockReason = z.infer<typeof shipBlockReasonSchema>;

export const shipBlockSchema = z.object({ reason: shipBlockReasonSchema, message: z.string() });
export type ShipBlock = z.infer<typeof shipBlockSchema>;

export const QUIET_SHIP_BLOCKS: readonly ShipBlockReason[] = [
  'no_changes',
  'not_repo',
  'nothing_new',
];

export const shipPreviewSchema = z.object({
  branch: z.string(),
  baseBranch: z.string().nullable(),
  title: z.string(),
  files: z.array(shipFileSchema),
  skipped: z.array(shipSkippedFileSchema),
  remote: shipRemoteSchema.nullable(),
  modes: z.array(shipModeSchema),
  blocked: shipBlockSchema.nullable(),
  notes: z.array(z.string()),
  github: z.object({ method: githubMethodSchema, host: z.string() }).nullable(),
  shipped: shipStateSchema.nullable(),
});
export type ShipPreview = z.infer<typeof shipPreviewSchema>;

export const shipRequestSchema = z.object({
  mode: shipModeSchema,
  title: z.string().trim().min(1).max(SHIP_TITLE_MAX_LENGTH).optional(),
});
export type ShipRequest = z.infer<typeof shipRequestSchema>;

export const shipResultSchema = z.object({
  mode: shipModeSchema,
  branch: z.string(),
  commit: z.string().nullable(),
  committedFiles: z.array(z.string()),
  pushed: z.boolean(),
  pullRequest: shipPullRequestSchema.extend({ created: z.boolean() }).nullable(),
  link: taskLinkSchema.nullable(),
});
export type ShipResult = z.infer<typeof shipResultSchema>;

export const shipModeLabels: Record<ShipMode, string> = {
  draft_pr: 'Open draft PR',
  push: 'Push branch',
  commit: 'Commit',
};

const MODE_PREFERENCE: readonly ShipMode[] = ['draft_pr', 'push', 'commit'];

export function preferredShipMode(modes: readonly ShipMode[]): ShipMode | null {
  return MODE_PREFERENCE.find((mode) => modes.includes(mode)) ?? null;
}

const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i;

export const githubHostSchema = z.string().trim().toLowerCase().regex(HOST).max(253);

export const githubRepoAccessSchema = z.object({
  repo: z.string(),
  access: z.enum(['push', 'read', 'none']),
});
export type GitHubRepoAccess = z.infer<typeof githubRepoAccessSchema>;

export const githubTokenInfoSchema = z.object({
  host: z.string(),
  login: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  validatedAt: z.string(),
  repos: z.array(githubRepoAccessSchema),
});
export type GitHubTokenInfo = z.infer<typeof githubTokenInfoSchema>;

export const githubConnectionSchema = z.object({
  active: githubMethodSchema.nullable(),
  ghCli: z.object({
    installed: z.boolean(),
    host: z.string(),
    login: z.string().nullable(),
  }),
  token: githubTokenInfoSchema.nullable(),
  app: z.object({ available: z.literal(false) }),
});
export type GitHubConnectionStatus = z.infer<typeof githubConnectionSchema>;

export const saveGitHubTokenRequestSchema = z.object({
  token: z.string().trim().min(20).max(400),
  host: githubHostSchema.optional(),
});
export type SaveGitHubTokenRequest = z.infer<typeof saveGitHubTokenRequestSchema>;

const TOKEN_PREFIXES = ['github_pat_', 'ghp_'];

export function githubTokenHint(token: string): { valid: boolean; message: string } {
  const trimmed = token.trim();
  if (!trimmed) {
    return {
      valid: false,
      message: 'Paste a fine-grained personal access token with Contents and Pull requests access.',
    };
  }
  if (!TOKEN_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) || /\s/.test(trimmed)) {
    return {
      valid: false,
      message: 'GitHub tokens start with github_pat_ (fine-grained) or ghp_ (classic).',
    };
  }
  return { valid: true, message: 'Looks right. Verify to check it with GitHub.' };
}
