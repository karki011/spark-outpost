import { z } from 'zod';

export const chatFileSchema = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  name: z.string().min(1).max(255),
  path: z.string().min(1).max(1024),
  size: z.number().int().nonnegative(),
  mediaType: z.string().min(1).max(100),
  kind: z.enum(['image', 'file']),
});
export type ChatFile = z.infer<typeof chatFileSchema>;

export function chatFileContentPath(id: string): string {
  return `/chat-files/${id}/content`;
}
