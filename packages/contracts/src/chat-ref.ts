import { z } from 'zod';

export const chatRefSchema = z.object({ id: z.uuid(), title: z.string() });
export type ChatRef = z.infer<typeof chatRefSchema>;
