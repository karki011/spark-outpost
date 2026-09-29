import {
  modeForLegacy,
  PERMISSION_ASK,
  PLAN_DOCUMENT_MAX_LENGTH,
  type RunMode,
} from '@spark-outpost/contracts';
import { objectFields } from '../agents/acp/object-fields.ts';

const SWITCH_MODE_KIND = 'switch_mode';
export const PLAN_MODE_ID = 'plan';
const EXIT_PLAN_PREFIX = 'exit-plan-';
export const ENTER_PLAN_MODE_TITLE = 'EnterPlanMode';
export const ENTER_PLAN_MODE_WHY = 'planning changes no files';

interface PlanToolContent {
  type: string;
  content?: { type: string; text?: string };
}

export function isExitPlanAllow(optionId: string | null | undefined): boolean {
  return typeof optionId === 'string' && optionId.startsWith(EXIT_PLAN_PREFIX);
}

export function exitPlanText(
  toolKind: string | null | undefined,
  rawInput: unknown,
  content: readonly PlanToolContent[] | null | undefined,
): string | null {
  if (toolKind !== SWITCH_MODE_KIND) return null;
  const input = objectFields(rawInput).plan;
  const shown = (content ?? [])
    .flatMap((item) =>
      item.type === 'content' && item.content?.type === 'text' ? [item.content.text ?? ''] : [],
    )
    .join('\n\n');
  const text = (typeof input === 'string' && input.trim() ? input : shown).trim();
  return text ? text.slice(0, PLAN_DOCUMENT_MAX_LENGTH) : null;
}

export function readOnlyChatPlans(provider: string, mode: RunMode | null): boolean {
  return mode === 'ask' && modeForLegacy(provider, PERMISSION_ASK, null) === PLAN_MODE_ID;
}
