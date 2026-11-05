import { redactText } from '@spark-outpost/contracts';
import type { FeedbackTarget } from './feedback-target.ts';

export const FEEDBACK_FIELD_MAX = 2000;
const TITLE_MAX = 70;
const MISSED_SEARCHES_MAX = 10;

export interface FeedbackReport {
  happened: string;
  expected: string;
  version: string | null;
  beta: boolean;
  diagnostics: string | null;
  missedDocsSearches?: readonly string[];
}

export type FeedbackDraft =
  | { kind: 'github'; url: string; body: string }
  | { kind: 'email'; url: string; body: string }
  | { kind: 'copy'; body: string };

function clean(text: string): string {
  return redactText(text.trim()).slice(0, FEEDBACK_FIELD_MAX);
}

function versionLine(report: FeedbackReport): string {
  if (!report.version) return 'Spark Outpost in the browser';
  return `Spark Outpost ${report.version}${report.beta ? ' (Beta)' : ''}`;
}

export function feedbackBody(report: FeedbackReport): string {
  const parts = [
    'What happened:',
    clean(report.happened) || '(not filled in)',
    '',
    'What I expected:',
    clean(report.expected) || '(not filled in)',
    '',
    versionLine(report),
  ];
  if (report.diagnostics) parts.push(`Diagnostics: attached ${report.diagnostics}`);
  const missed = (report.missedDocsSearches ?? []).slice(-MISSED_SEARCHES_MAX);
  if (missed.length > 0) {
    parts.push(`Docs searches with no results: ${clean(missed.join('; '))}`);
  }
  return `${parts.join('\n')}\n`;
}

export function feedbackTitle(report: FeedbackReport): string {
  const first = clean(report.happened).split('\n')[0] ?? '';
  const short = first.length > TITLE_MAX ? `${first.slice(0, TITLE_MAX - 1)}…` : first;
  return `${report.beta ? 'Beta feedback' : 'Feedback'}: ${short || 'Spark Outpost'}`;
}

export function draftKind(target: FeedbackTarget): FeedbackDraft['kind'] {
  if (target.repo) return 'github';
  return target.email ? 'email' : 'copy';
}

export function feedbackDraft(target: FeedbackTarget, report: FeedbackReport): FeedbackDraft {
  const body = feedbackBody(report);
  const title = feedbackTitle(report);
  if (target.repo) {
    const query = new URLSearchParams({ title, body });
    return { kind: 'github', url: `https://github.com/${target.repo}/issues/new?${query}`, body };
  }
  if (target.email) {
    const query = `subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    return { kind: 'email', url: `mailto:${encodeURIComponent(target.email)}?${query}`, body };
  }
  return { kind: 'copy', body };
}

export function fileName(savedPath: string): string {
  return savedPath.split(/[\\/]/).pop() ?? savedPath;
}
