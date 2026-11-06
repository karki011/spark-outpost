import { z } from 'zod';

export const providerIdSchema = z.enum(['claude', 'codex', 'zai', 'custom']);
export type ProviderId = z.infer<typeof providerIdSchema>;
