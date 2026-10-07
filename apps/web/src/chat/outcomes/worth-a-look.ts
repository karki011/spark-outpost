import type { CheckpointPayload } from '@spark-outpost/contracts';

export interface WorthALookItems {
  items: string[];
  outsidePlan: string[];
}

const STORED_OUTSIDE_PLAN = /^Changed `([^`]+)`, which the request and plan didn['’]t name\b/;

function meaning(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`'’"“”]/g, '')
    .replace(/[\s.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function distinct(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  return texts.filter((text) => {
    const key = meaning(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function worthALook(
  payload: Pick<CheckpointPayload, 'laws' | 'outsidePlan'>,
): WorthALookItems {
  const items: string[] = [];
  const outside = [...payload.outsidePlan];
  for (const law of payload.laws) {
    const stored = STORED_OUTSIDE_PLAN.exec(law);
    if (stored) outside.push(stored[1]!);
    else items.push(law);
  }
  return { items: distinct(items), outsidePlan: distinct(outside) };
}

export function outsidePlanLabel(count: number): string {
  return `${count} file${count === 1 ? '' : 's'} outside the plan`;
}
