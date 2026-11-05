import { z } from 'zod';

export const BROWSER_DOWNLOADS_KEPT = 30;

export const browserDownloadSchema = z.object({
  id: z.string().min(1).max(40),
  filename: z.string().max(255),
  host: z.string().max(255),
  where: z.enum(['personal', 'work', 'chat']),
  by: z.enum(['you', 'agent', 'page']),
  state: z.enum(['saving', 'saved', 'cancelled', 'failed', 'blocked']),
  receivedBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  at: z.string(),
});
export type BrowserDownload = z.infer<typeof browserDownloadSchema>;

export const browserDownloadsSchema = z.array(browserDownloadSchema).max(BROWSER_DOWNLOADS_KEPT);

export const browserDownloadActionSchema = z.object({
  id: z.string().min(1).max(40),
  action: z.enum(['show', 'cancel']),
});
export type BrowserDownloadAction = z.infer<typeof browserDownloadActionSchema>;
