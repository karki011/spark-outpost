import { z } from 'zod';

export const PROJECT_FILES_LIMIT = 50;
export const CONVERSATION_PROJECTS_MAX = 8;

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  rootPath: z.string(),
  displayPath: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  commandAllowlist: z.array(z.string()),
  checkCommands: z.array(z.string()).nullable().optional(),
});
export type Project = z.infer<typeof projectSchema>;

export const createProjectRequestSchema = z.object({
  rootPath: z.string().trim().min(1).max(4096),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const PROJECT_NAME_MAX = 100;
export const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX);

export const projectOrderRequestSchema = z.object({
  projectIds: z.array(z.uuid()).min(1).max(500),
});
export type ProjectOrderRequest = z.infer<typeof projectOrderRequestSchema>;

export const projectLinkSchema = z.object({
  conversationId: z.uuid(),
  position: z.number().int().min(0),
});
export type ProjectLink = z.infer<typeof projectLinkSchema>;

export const removedProjectSchema = z.object({
  project: projectSchema,
  links: z.array(projectLinkSchema).max(10_000),
});
export type RemovedProject = z.infer<typeof removedProjectSchema>;

export const folderEntrySchema = z.object({ name: z.string(), path: z.string() });
export type FolderEntry = z.infer<typeof folderEntrySchema>;

export const folderListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  folders: z.array(folderEntrySchema),
});
export type FolderListing = z.infer<typeof folderListingSchema>;

export const projectFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

export const projectFilesResponseSchema = z.object({
  files: z.array(projectFileSchema),
  truncated: z.boolean(),
});
export type ProjectFilesResponse = z.infer<typeof projectFilesResponseSchema>;

export const attachProjectFileRequestSchema = z.object({
  path: z.string().trim().min(1).max(4096),
});
export type AttachProjectFileRequest = z.infer<typeof attachProjectFileRequestSchema>;

export const projectGitSchema = z.object({ branch: z.string().nullable() });
export type ProjectGit = z.infer<typeof projectGitSchema>;
