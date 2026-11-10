import { z } from 'zod';
import { artifactPageKindSchema } from './artifact-pages.ts';
import { chatDraftSchema } from './outposts.ts';

export const libraryFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  size: z.number().int().nonnegative(),
});
export type LibraryFile = z.infer<typeof libraryFileSchema>;

export const libraryArtifactSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: artifactPageKindSchema,
  versions: z.number().int().positive(),
});
export type LibraryArtifact = z.infer<typeof libraryArtifactSchema>;

export const outpostLibrarySchema = z.object({
  chats: z.array(
    z.object({
      conversationId: z.uuid(),
      files: z.array(libraryFileSchema),
      artifacts: z.array(libraryArtifactSchema),
    }),
  ),
});
export type OutpostLibraryChats = z.infer<typeof outpostLibrarySchema>;

export const outpostSuggestionsSchema = z.object({
  drafts: z.array(chatDraftSchema.extend({ conversationId: z.uuid() })),
});
export type OutpostSuggestions = z.infer<typeof outpostSuggestionsSchema>;
