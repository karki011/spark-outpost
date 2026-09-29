import { z } from 'zod';

export const personalitySchema = z.enum(['playful', 'friendly', 'facts']);
export type Personality = z.infer<typeof personalitySchema>;

export const DEFAULT_PERSONALITY: Personality = 'friendly';

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}
