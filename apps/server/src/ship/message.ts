import type { PlanDocument, ReviewBody, ShipFile } from '@spark-outpost/contracts';
import { outlinePlan } from '../plans/agreed-block.ts';

export const SHIP_FOOTER = '🤖 Generated with Spark Outpost';
const SUBJECT_MAX = 72;
const SUMMARY_MAX = 1_500;
const COMMIT_SUMMARY_LINES = 12;
const FILES_SHOWN = 100;
const BODY_MAX = 60_000;

export interface ShipSummary {
  title: string;
  summary: string | null;
  files: readonly ShipFile[];
  checks: readonly string[];
  review: Pick<ReviewBody, 'verdict' | 'findings' | 'sameProvider'> | null;
  costUsd: number | null;
  costEstimated: boolean;
  plan: PlanDocument | null;
}

const VERDICTS: Record<ReviewBody['verdict'], string> = {
  looks_good: 'looks good',
  concerns: 'has concerns',
  unclear: 'was unclear',
};

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1).trimEnd()}…` : trimmed;
}

export function commitSubject(title: string): string {
  return clip(title.replace(/\s+/g, ' '), SUBJECT_MAX);
}

function reviewLine(review: NonNullable<ShipSummary['review']>): string {
  const same = review.sameProvider ? ' (same provider, no cross-model review)' : '';
  return `AI review ${VERDICTS[review.verdict]}${same}`;
}

export function commitBody(summary: ShipSummary): string {
  const sections: string[] = [];
  if (summary.summary) {
    const lines = clip(summary.summary, SUMMARY_MAX).split('\n').slice(0, COMMIT_SUMMARY_LINES);
    sections.push(lines.join('\n'));
  }
  if (summary.checks.length > 0) {
    sections.push(summary.checks.map((line) => `Checks: ${line}`).join('\n'));
  }
  if (summary.review) {
    const findings = summary.review.findings.map((finding) => `- ${clip(finding, 200)}`);
    sections.push([`Review: ${reviewLine(summary.review)}`, ...findings].join('\n'));
  }
  sections.push(SHIP_FOOTER);
  return sections.join('\n\n');
}

function money(value: number): string {
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

function filesSection(files: readonly ShipFile[]): string[] {
  const shown = files.slice(0, FILES_SHOWN).map((file) => `- \`${file.path}\` (${file.change})`);
  if (files.length > FILES_SHOWN) shown.push(`- … and ${files.length - FILES_SHOWN} more`);
  return ['## Changed files', ...(shown.length > 0 ? shown : ['No new files in this push.'])];
}

function planSection(plan: PlanDocument): string[] {
  const outline = outlinePlan(plan.body);
  const day = (plan.approvedAt ?? plan.createdAt).slice(0, 10);
  const lines = [`## Agreed plan`, `Plan v${plan.version}, approved ${day}.`];
  if (outline.goal) lines.push(`Goal: ${outline.goal}`);
  const details = [...outline.open, ...outline.decisions].map((item) => `- ${item}`);
  if (details.length > 0) {
    lines.push('<details><summary>Plan outline</summary>', '', ...details, '', '</details>');
  }
  return lines;
}

export function pullRequestBody(summary: ShipSummary): string {
  const sections: string[][] = [
    ['## Summary', summary.summary ? clip(summary.summary, SUMMARY_MAX) : summary.title],
    filesSection(summary.files),
    [
      '## Checks',
      ...(summary.checks.length > 0
        ? summary.checks.map((line) => `- ${line}`)
        : ['No project checks ran.']),
    ],
  ];
  if (summary.review) {
    sections.push([
      '## Critic findings',
      reviewLine(summary.review),
      ...summary.review.findings.map((finding) => `- ${finding}`),
    ]);
  }
  if (summary.plan) sections.push(planSection(summary.plan));
  if (summary.costUsd !== null) {
    sections.push([
      `Cost: ${summary.costEstimated ? '~' : ''}${money(summary.costUsd)}${summary.costEstimated ? ' (estimated)' : ''}`,
    ]);
  }
  const body = sections.map((lines) => lines.join('\n')).join('\n\n');
  return `${clip(body, BODY_MAX)}\n\n${SHIP_FOOTER}`;
}
