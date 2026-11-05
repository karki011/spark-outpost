import { PLAN_DOCUMENT_MAX_LENGTH } from '@spark-outpost/contracts';

const PROPOSED_PLAN = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/g;

export function proposedPlan(text: string): string | null {
  const blocks = [...text.matchAll(PROPOSED_PLAN)].map((match) => match[1]!.trim()).filter(Boolean);
  const last = blocks.at(-1);
  return last ? last.slice(0, PLAN_DOCUMENT_MAX_LENGTH) : null;
}
