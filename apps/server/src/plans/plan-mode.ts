import { PLAN_DOCUMENT_MAX_LENGTH } from '@spark-outpost/contracts';

export const SWITCH_MODE_KIND = 'switch_mode';
export const EXIT_PLAN_PREFIX = 'exit-plan-';
export const ENTER_PLAN_MODE_TITLE = 'EnterPlanMode';
export const ENTER_PLAN_MODE_WHY = 'planning changes no files';

interface PlanToolContent {
  type: string;
  content?: { type: string; text?: string };
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export function isExitPlanAllow(optionId: string | null | undefined): boolean {
  return typeof optionId === 'string' && optionId.startsWith(EXIT_PLAN_PREFIX);
}

export function exitPlanText(
  toolKind: string | null | undefined,
  rawInput: unknown,
  content: readonly PlanToolContent[] | null | undefined,
): string | null {
  if (toolKind !== SWITCH_MODE_KIND) return null;
  const input = record(rawInput).plan;
  const shown = (content ?? [])
    .flatMap((item) =>
      item.type === 'content' && item.content?.type === 'text' ? [item.content.text ?? ''] : [],
    )
    .join('\n\n');
  const text = (typeof input === 'string' && input.trim() ? input : shown).trim();
  return text ? text.slice(0, PLAN_DOCUMENT_MAX_LENGTH) : null;
}
