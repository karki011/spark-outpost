import { z } from 'zod';
import { workPlaceSchema } from './chat-workspace.ts';
import { previewConfigSchema } from './preview.ts';

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
  workPlace: workPlaceSchema.optional(),
  preview: previewConfigSchema.nullable().optional(),
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

export const FOLDER_NAME_MAX_BYTES = 255;

function utf8Length(text: string): number {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

export function folderNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Name the folder.';
  if (/[/:]/.test(trimmed) || hasControlCharacter(trimmed)) {
    return 'Folder names can’t contain / or :.';
  }
  if (trimmed.startsWith('.')) return 'Folder names can’t start with a dot.';
  if (utf8Length(trimmed) > FOLDER_NAME_MAX_BYTES) {
    return 'That name is too long.';
  }
  return null;
}

export const folderNameSchema = z
  .string()
  .max(1024)
  .transform((name) => name.trim())
  .superRefine((name, context) => {
    const problem = folderNameProblem(name);
    if (problem) context.addIssue({ code: 'custom', message: problem });
  });

export const createFolderRequestSchema = z.object({
  parent: z.string().trim().min(1).max(4096),
  name: folderNameSchema,
});
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;

export const createdFolderSchema = z.object({ path: z.string() });
export type CreatedFolder = z.infer<typeof createdFolderSchema>;

export const folderFileSchema = folderEntrySchema.extend({
  sizeBytes: z.number().int().nonnegative(),
});
export type FolderFile = z.infer<typeof folderFileSchema>;

export const folderListingEntrySchema = folderEntrySchema.extend({
  repository: z.boolean().default(false),
});
export type FolderListingEntry = z.infer<typeof folderListingEntrySchema>;

export const folderListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  folders: z.array(folderListingEntrySchema),
  files: z.array(folderFileSchema).default([]),
  places: z.array(folderEntrySchema).default([]),
  denied: z.string().nullable().default(null),
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

export const projectFileContentSchema = z.object({
  path: z.string(),
  text: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type ProjectFileContent = z.infer<typeof projectFileContentSchema>;

export const projectGitSchema = z.object({
  branch: z.string().nullable(),
  repository: z.boolean().nullable(),
  problem: z.string().nullable().default(null),
});
export type ProjectGit = z.infer<typeof projectGitSchema>;
