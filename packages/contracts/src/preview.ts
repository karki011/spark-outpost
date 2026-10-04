import { z } from 'zod';
import { addressToUrl, classifyBrowserUrl, parseBrowserUrl } from './browser.ts';

export const PREVIEW_COMMAND_MAX = 500;
export const PREVIEW_FOLDER_MAX = 500;
export const PREVIEW_LOG_TAIL_MAX = 6000;

const CONTROL_CHARACTER = /[\p{Cc}]/u;
const WEB_PAGE = /^https?:$/;

export function localPreviewUrl(typed: string): string | null {
  const url = addressToUrl(typed);
  if (!url || classifyBrowserUrl(url) !== 'local') return null;
  return WEB_PAGE.test(parseBrowserUrl(url)?.protocol ?? '') ? url : null;
}

export function insideProjectFolder(folder: string): boolean {
  if (folder.startsWith('/') || folder.startsWith('~') || folder.includes('\\')) return false;
  return !folder.split('/').includes('..');
}

const commandSchema = z
  .string()
  .trim()
  .min(1, 'Type the command that starts your dev server, for example pnpm dev.')
  .max(PREVIEW_COMMAND_MAX)
  .refine((command) => !CONTROL_CHARACTER.test(command), 'The command must be one line.');

const localUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((typed, context) => {
    const url = localPreviewUrl(typed);
    if (url) return url;
    context.addIssue({
      code: 'custom',
      message: 'Use an address on this Mac, for example http://localhost:5173.',
    });
    return z.NEVER;
  });

const folderSchema = z
  .string()
  .trim()
  .max(PREVIEW_FOLDER_MAX)
  .refine(insideProjectFolder, 'Use a folder inside the project, for example apps/web.')
  .transform((folder) => folder.replace(/^(?:\.\/)+|\/+$/g, ''));

function emptyAsNull<Schema extends z.ZodType>(schema: Schema) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    schema.nullable().default(null),
  );
}

export const previewConfigSchema = z.strictObject({
  command: commandSchema,
  url: localUrlSchema,
  folder: emptyAsNull(folderSchema),
  readyUrl: emptyAsNull(localUrlSchema),
});
export type PreviewConfig = z.infer<typeof previewConfigSchema>;
export type PreviewConfigInput = z.input<typeof previewConfigSchema>;

export const savePreviewRequestSchema = z.strictObject({
  preview: previewConfigSchema.nullable(),
});

export const previewSuggestionSchema = z.object({
  source: z.enum(['launch.json', 'package.json']),
  label: z.string().max(200),
  config: previewConfigSchema,
});
export type PreviewSuggestion = z.infer<typeof previewSuggestionSchema>;

export const projectPreviewSchema = z.object({
  preview: previewConfigSchema.nullable(),
  suggestions: z.array(previewSuggestionSchema).max(12),
});
export type ProjectPreview = z.infer<typeof projectPreviewSchema>;

export const previewStatusSchema = z.enum(['starting', 'ready', 'failed', 'stopped']);
export type PreviewStatus = z.infer<typeof previewStatusSchema>;

export const previewAskerSchema = z.enum(['user', 'agent', 'spark']);
export type PreviewAsker = z.infer<typeof previewAskerSchema>;

export const previewServerSchema = z.object({
  id: z.uuid(),
  status: previewStatusSchema,
  url: z.string().nullable(),
  folder: z.string(),
  detail: z.string().nullable(),
  restarts: z.number().int().min(0),
  askedBy: previewAskerSchema,
  updatedAt: z.string(),
});
export type PreviewServer = z.infer<typeof previewServerSchema>;

export const chatPreviewSchema = z.object({
  projectId: z.uuid().nullable(),
  projectName: z.string().nullable(),
  preview: previewConfigSchema.nullable(),
  server: previewServerSchema.nullable(),
});
export type ChatPreview = z.infer<typeof chatPreviewSchema>;

export const previewTerminalRequestSchema = z.strictObject({ conversationId: z.uuid() });

export function previewLive(server: PreviewServer | null | undefined): boolean {
  return server?.status === 'starting' || server?.status === 'ready';
}
