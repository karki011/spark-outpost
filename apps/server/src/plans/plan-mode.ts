import {
  modeForLegacy,
  PERMISSION_ASK,
  PLAN_DOCUMENT_MAX_LENGTH,
  type RunMode,
} from '@spark-outpost/contracts';
import { objectFields } from '../agents/acp/object-fields.ts';
import { planOnlyByRule } from '../orchestration/risk-rules.ts';

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

export const PLANS_DIR = '.spark/plans';
const PLAN_FILE = /(?:^|\/)\.(?:claude|spark)\/plans\/[^/]+\.md$/;
const SPARK_PLAN_FILE = /(?:^|\/)\.spark\/plans\/[^/]+\.md$/;

function isPlanFile(target: unknown): target is string {
  return typeof target === 'string' && PLAN_FILE.test(target);
}

export function isSparkPlanFile(target: unknown): boolean {
  return typeof target === 'string' && SPARK_PLAN_FILE.test(target);
}

export function isExitPlanKind(toolKind: string | null | undefined): boolean {
  return toolKind === SWITCH_MODE_KIND;
}

export function planFileText(rawInput: unknown): string | null {
  const fields = objectFields(rawInput);
  const { file_path: target, content } = fields;
  if (!isPlanFile(target)) return null;
  if (typeof content !== 'string' || !content.trim()) return null;
  return content.trim().slice(0, PLAN_DOCUMENT_MAX_LENGTH);
}

export interface PlanningFacts {
  planning?: boolean;
  provider: string;
  mode: RunMode | null;
  userRequest: string;
}

export function plansThisTurn(facts: PlanningFacts): boolean {
  if (facts.planning !== undefined) return facts.planning;
  if (facts.mode !== 'ask') return false;
  const planModeChat = modeForLegacy(facts.provider, PERMISSION_ASK, null) === PLAN_MODE_ID;
  return planModeChat || planOnlyByRule(facts.userRequest);
}
