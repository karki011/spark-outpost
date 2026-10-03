export const POLICY_BLOCKED = "Spark's policy blocked";

export function blockedNote(what: string, reason: string): string {
  return `${POLICY_BLOCKED} ${what} (${reason})`;
}

export function policyDenial(note: string): string {
  return `${note}. This is Spark's rule, not the user's choice; don't tell the user they declined it.`;
}
