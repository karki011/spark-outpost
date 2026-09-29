import { z } from 'zod';

export const personalitySchema = z.enum(['playful', 'friendly', 'facts']);
export type Personality = z.infer<typeof personalitySchema>;

export const DEFAULT_PERSONALITY: Personality = 'friendly';

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}

export const DEFAULT_MORNING_BRIEF_TIME = '07:00';
export const morningBriefTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SPEND_CAP_MIN_USD = 0.01;
export const SPEND_CAP_MAX_USD = 10_000;
export const spendCapUsdSchema = z.number().min(SPEND_CAP_MIN_USD).max(SPEND_CAP_MAX_USD);
