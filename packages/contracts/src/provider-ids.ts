import { z } from 'zod';

export const providerIdSchema = z.enum(['claude', 'codex', 'zai']);
export type ProviderId = z.infer<typeof providerIdSchema>;
