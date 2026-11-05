import { z } from 'zod';

export const INVOLVEMENT_LEVEL_IDS = ['hands-off', 'full-auto'] as const;
export type InvolvementLevel = (typeof INVOLVEMENT_LEVEL_IDS)[number];

const RETIRED_LEVELS: readonly unknown[] = ['hands-on', 'balanced'];

export const involvementLevelSchema = z.preprocess(
  (value) => (RETIRED_LEVELS.includes(value) ? 'hands-off' : value),
  z.enum(INVOLVEMENT_LEVEL_IDS),
);
