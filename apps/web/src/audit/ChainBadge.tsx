import { useQueries } from '@tanstack/react-query';
import type { AuditRunSummary, ChainVerification } from '@spark-outpost/contracts';
import { ShieldIcon } from '../ui/icons.tsx';
import { auditApi, auditKeys } from './audit-api.ts';

export type ChainChecks = ReadonlyMap<string, ChainVerification>;

export function useChainChecks(runs: readonly AuditRunSummary[]): ChainChecks {
  const logged = runs.filter((run) => run.logEntries > 0);
  return useQueries({
    queries: logged.map((run) => ({
      queryKey: auditKeys.verify(run.runId),
      queryFn: () => auditApi.verify(run.runId),
    })),
    combine: (results) =>
      new Map(
        results.flatMap((result) => (result.data ? [[result.data.runId, result.data]] : [])),
      ) as ChainChecks,
  });
}

interface Badge {
  tone: 'ok' | 'bad' | 'quiet';
  text: string;
  detail?: string;
}

function events(count: number): string {
  return `${count} ${count === 1 ? 'event' : 'events'}`;
}

function brokenText(check: ChainVerification): string {
  return `Chain broken at #${check.firstBrokenSeq ?? '?'}${check.reason ? `: ${check.reason}` : ''}`;
}

export function runBadge(run: AuditRunSummary, check: ChainVerification | undefined): Badge {
  if (run.logPruned) return { tone: 'quiet', text: 'Log removed after retention' };
  if (run.logEntries === 0) return { tone: 'quiet', text: 'Nothing recorded' };
  if (!check) return { tone: 'quiet', text: 'Checking chain…' };
  if (!check.intact) return { tone: 'bad', text: brokenText(check) };
  return { tone: 'ok', text: `Chain verified · ${events(check.checked)}` };
}

export function sessionBadge(runs: readonly AuditRunSummary[], checks: ChainChecks): Badge {
  const logged = runs.filter((run) => run.logEntries > 0);
  if (logged.length === 0) return { tone: 'quiet', text: 'No protocol log recorded' };
  const broken = logged.filter((run) => checks.get(run.runId)?.intact === false);
  if (broken.length > 0) {
    return {
      tone: 'bad',
      text: `Hash chain broken in ${broken.length} of ${logged.length} runs`,
      detail: broken.map((run) => brokenText(checks.get(run.runId)!)).join('\n'),
    };
  }
  if (logged.some((run) => !checks.has(run.runId))) {
    return { tone: 'quiet', text: 'Checking hash chain…' };
  }
  const checked = logged.reduce((total, run) => total + (checks.get(run.runId)?.checked ?? 0), 0);
  return { tone: 'ok', text: `Hash chain verified · ${events(checked)}` };
}

export function BadgeView({ badge }: { badge: Badge }) {
  return (
    <span
      className={`chain ${badge.tone}`}
      role={badge.tone === 'bad' ? 'alert' : 'status'}
      title={badge.detail ?? badge.text}
    >
      {badge.tone !== 'quiet' && <ShieldIcon />}
      {badge.text}
    </span>
  );
}

export function ChainBadge({
  runs,
  checks,
}: {
  runs: readonly AuditRunSummary[];
  checks: ChainChecks;
}) {
  return <BadgeView badge={sessionBadge(runs, checks)} />;
}
