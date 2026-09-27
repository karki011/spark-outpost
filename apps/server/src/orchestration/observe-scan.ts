import { renderJevState } from '../codescan/jev-state.ts';
import type { ScanOutcome } from '../codescan/scanner.ts';
import { insertDecision } from '../persistence/orchestrations.ts';
import { track } from './observe.ts';
import type { Session } from './session.ts';

export const SCAN_TOP_FILES = 10;

function summaryOf(outcome: ScanOutcome): string {
  const report = outcome.report;
  if (outcome.status === 'failed') return `Code scan failed after ${outcome.elapsedMs} ms`;
  if (!report)
    return `Code scan found nothing in time (${outcome.status}, ${outcome.elapsedMs} ms)`;
  const top = report.candidates[0]?.path ?? 'none';
  const partial = report.partial ? ' (partial)' : '';
  return `Code scan ranked ${report.candidates.length} files in ${outcome.elapsedMs} ms${partial}; top: ${top}`;
}

export function scanAnswer(outcome: ScanOutcome): Record<string, unknown> {
  const report = outcome.report;
  const state = report ? renderJevState(report) : null;
  return {
    observation: true,
    status: outcome.status,
    error: outcome.error,
    elapsedMs: outcome.elapsedMs,
    queuedMs: outcome.queuedMs,
    index: report?.index ?? null,
    indexedFiles: report?.indexedFiles ?? null,
    partial: report?.partial ?? null,
    timings: report?.timings ?? null,
    terms: report?.terms ?? null,
    candidates: report?.candidates.length ?? 0,
    topFiles: (report?.candidates ?? []).slice(0, SCAN_TOP_FILES).map((file) => ({
      path: file.path,
      score: file.score,
      reasons: file.reasons,
    })),
    summary: report?.summary ?? null,
    jevState: state ? { tokens: state.tokens, files: state.files, chars: state.text.length } : null,
  };
}

async function recordScan(s: Session, scanning: Promise<ScanOutcome>): Promise<void> {
  const outcome = await scanning;
  await insertDecision(s.deps.db, {
    runId: s.lease.runId,
    purpose: 'scan',
    childRunId: null,
    role: null,
    stepIndex: null,
    jevStatus: 'not_asked',
    inputTokens: null,
    costUsd: null,
    body: {
      summary: summaryOf(outcome),
      applied: 'rules',
      gate: null,
      jevError: null,
      jevModel: null,
      latencyMs: outcome.elapsedMs,
      answer: scanAnswer(outcome),
    },
  });
}

export function startScan(
  s: Pick<Session, 'deps' | 'input'>,
  root: string | undefined,
): Promise<ScanOutcome> | null {
  if (!root || !s.deps.codeScan || s.input.mode !== 'do') return null;
  return s.deps.codeScan.scan(root, s.input.userRequest).catch((error: unknown): ScanOutcome => ({
    status: 'failed',
    report: null,
    error: error instanceof Error ? error.message : String(error),
    elapsedMs: 0,
    queuedMs: 0,
  }));
}

export function observeScan(s: Session, scanning: Promise<ScanOutcome> | null): void {
  if (scanning) track(s, recordScan(s, scanning));
}
