import { z } from 'zod';

export const ATTACHMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_TEXT_MAX_BYTES = 512 * 1024;
export const ATTACHMENT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const ATTACHMENT_PDF_INLINE_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_MESSAGE = 10;
export const ATTACHMENT_NAME_MAX_LENGTH = 200;
export const ATTACHMENT_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

export const attachmentKindSchema = z.enum(['image', 'text', 'file']);
export type AttachmentKind = z.infer<typeof attachmentKindSchema>;

export const attachmentSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(ATTACHMENT_NAME_MAX_LENGTH),
  mediaType: z.string(),
  size: z.number().int().nonnegative(),
  kind: attachmentKindSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

export function attachmentContentPath(id: string): string {
  return `/attachments/${id}/content`;
}
