export const ALLOWED_ON_CARD =
  'The user allowed this on a Spark card before it ran; say so if you report it.';

export function allowedNote(...decisions: readonly string[]): { allowed?: string } {
  return decisions.includes('user_allowed') ? { allowed: ALLOWED_ON_CARD } : {};
}
