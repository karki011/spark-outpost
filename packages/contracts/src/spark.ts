import { z } from 'zod';

export const personalitySchema = z.enum(['playful', 'friendly', 'facts']);
export type Personality = z.infer<typeof personalitySchema>;

export const DEFAULT_PERSONALITY: Personality = 'friendly';

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

export const DEFAULT_MORNING_BRIEF_TIME = '07:00';
export const morningBriefTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
