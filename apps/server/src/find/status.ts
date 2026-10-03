import { redactText } from '../audit/redact.ts';
import type { ScanOutcome } from '../codescan/scanner.ts';
import type { CodeLeads } from './leads.ts';

export type FindStatus = 'complete' | 'partial' | 'index_building';

export function findIssues(outcome: ScanOutcome, found: CodeLeads): string[] {
  const issues: string[] = [];
  const report = outcome.report;
  if (outcome.status === 'failed') {
    issues.push(`The search failed: ${redactText(outcome.error ?? 'unknown error')}`);
  }
  if (outcome.status === 'timed_out' || outcome.status === 'queued_past_deadline') {
    issues.push('The search ran out of time before it found anything. Try again.');
  }
  if (report?.partial) issues.push('The search ran out of time; some matches may be missing.');
  if (report?.index === 'missing') {
    issues.push('This project has no code index yet. It is being built; text matches only.');
  }
  if (report?.index === 'building') {
    issues.push('The code index is still building; symbols and line ranges may be missing.');
  }
  if (found.withoutRanges > 0) {
    issues.push(`${found.withoutRanges} files have no declaration line ranges yet.`);
  }
  if (report && found.leads.length > 0 && !found.onMap) {
    issues.push('The Map has not placed these files yet, so areas are missing.');
  }
  return issues;
}

export function findStatus(outcome: ScanOutcome, found: CodeLeads): FindStatus {
  const index = outcome.report?.index;
  if (index === 'missing' || index === 'building') return 'index_building';
  if (outcome.status !== 'done' || found.withoutRanges > 0) return 'partial';
  return 'complete';
}
