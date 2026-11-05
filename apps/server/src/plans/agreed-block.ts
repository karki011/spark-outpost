import { PLAN_SOURCE_LABELS, type PlanDocument } from '@spark-outpost/contracts';

export const AGREED_PLAN_LIMIT = 2_000;
const AGREED_ITEMS = 12;
const AGREED_DECISIONS = 6;
const LINE_LIMIT = 240;
const STALE_FILES_SHOWN = 5;

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const LIST_ITEM = /^\s*(?:\d+[.)]|[-*+])\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const DECISION_HEADING =
  /\b(decision|decisions|approach|design|trade-?offs?|notes?|constraints?)\b/i;
const GOAL_PREFIX = /^\s*goal:\s*/i;
const GOAL_HEADING = /\b(goal|summary|context|overview)\b/i;

export interface PlanOutline {
  goal: string | null;
  open: string[];
  decisions: string[];
}

function clip(text: string, limit = LINE_LIMIT): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export function outlinePlan(body: string): PlanOutline {
  let heading = '';
  let title: string | null = null;
  let goal: string | null = null;
  const open: string[] = [];
  const decisions: string[] = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || FENCE.test(line)) continue;
    const found = HEADING.exec(line);
    if (found) {
      heading = found[1]!;
      if (!title && !GOAL_HEADING.test(heading) && !DECISION_HEADING.test(heading)) {
        title = clip(heading.replace(/^plan:?\s*/i, '')) || null;
      }
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const text = clip(item[2]!);
      if (!text) continue;
      if (DECISION_HEADING.test(heading)) decisions.push(text);
      else if (item[1]?.toLowerCase() !== 'x') open.push(text);
      continue;
    }
    if (!goal && line.trim()) goal = clip(line.replace(GOAL_PREFIX, '')) || null;
  }
  return { goal: goal ?? title, open, decisions };
}

function bullets(items: readonly string[], limit: number): string[] {
  const shown = items.slice(0, limit).map((item) => `- ${item}`);
  if (items.length > limit) shown.push(`- … and ${items.length - limit} more`);
  return shown;
}

function approvedDay(plan: PlanDocument): string {
  return (plan.approvedAt ?? plan.createdAt).slice(0, 10);
}

export function agreedPlanBlock(plan: PlanDocument, staleFiles: readonly string[] = []): string {
  const outline = outlinePlan(plan.body);
  const lines = [
    '## Agreed plan',
    `The user approved this plan (v${plan.version}, ${PLAN_SOURCE_LABELS[plan.source]}, ${approvedDay(plan)}). Follow it unless the request now asks for something else, and say so when you depart from it.`,
  ];
  if (staleFiles.length > 0) {
    const named = staleFiles.slice(0, STALE_FILES_SHOWN).join(', ');
    lines.push(
      `This plan may be out of date: ${named} changed since it was approved. Check them before relying on it.`,
    );
  }
  const structured = outline.open.length > 0 || outline.decisions.length > 0;
  if (!structured) {
    lines.push(clip(plan.body, AGREED_PLAN_LIMIT / 2));
    return lines.join('\n').slice(0, AGREED_PLAN_LIMIT);
  }
  if (outline.goal) lines.push(`Goal: ${outline.goal}`);
  if (outline.open.length > 0) lines.push('Open items:', ...bullets(outline.open, AGREED_ITEMS));
  if (outline.decisions.length > 0) {
    lines.push('Key decisions:', ...bullets(outline.decisions, AGREED_DECISIONS));
  }
  const block = lines.join('\n');
  return block.length > AGREED_PLAN_LIMIT
    ? `${block.slice(0, AGREED_PLAN_LIMIT)}\n[plan cut at ${AGREED_PLAN_LIMIT} characters]`
    : block;
}
