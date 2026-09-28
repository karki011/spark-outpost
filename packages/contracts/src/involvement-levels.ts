export const INVOLVEMENT_LEVEL_IDS = ['balanced', 'hands-off', 'full-auto'] as const;
export type InvolvementLevel = (typeof INVOLVEMENT_LEVEL_IDS)[number];
