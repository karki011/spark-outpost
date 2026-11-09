import type { ReactNode } from 'react';
import {
  mergeCostSource,
  providerLabel,
  type AuditRunSummary,
  type AuditSummary,
  type TotalCostSource,
} from '@spark-outpost/contracts';
import { categoryBreakdown, categoryName } from '../categories/category-usage.ts';
import { formatTokens } from '../chat/composer/model-options.ts';
import { CostText } from '../usage/CostText.tsx';
import type { CostSourceLabel } from '../usage/format.ts';
import { formatDuration } from './audit-model.ts';
import { AuditTable, ProviderDot, SourceTag } from './AuditTable.tsx';

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="astat">
      <small>{label}</small>
      <b>{children}</b>
    </div>
  );
}

const tokens = (count: number | null) => (count === null ? '—' : formatTokens(count));
const cost = (usd: number | null, source: CostSourceLabel) => (
  <CostText usd={usd} source={source} empty="not reported" />
);

function share(part: number | null, whole: number | null): string {
  if (part === null || !whole) return '—';
  const value = (part / whole) * 100;
  return `${value.toFixed(value < 1 && value > 0 ? 1 : 0)}%`;
}

interface RoleTotals {
  role: string;
  runs: number;
  totalTokens: number;
  costUsd: number | null;
  costSource: TotalCostSource | null;
  durationMs: number;
}

function byRole(runs: readonly AuditRunSummary[]): RoleTotals[] {
  const roles = new Map<string, RoleTotals>();
  for (const run of runs) {
    const row = roles.get(run.role) ?? {
      role: run.role,
      runs: 0,
      totalTokens: 0,
      costUsd: null,
      costSource: null,
      durationMs: 0,
    };
    row.runs += 1;
    row.totalTokens += run.totalTokens ?? 0;
    row.durationMs += run.durationMs ?? 0;
    if (run.costUsd !== null) {
      row.costUsd = (row.costUsd ?? 0) + run.costUsd;
      row.costSource = mergeCostSource(row.costSource, run.costSource ?? 'reported');
    }
    roles.set(run.role, row);
  }
  return [...roles.values()];
}

export function AuditSummaryPane({ summary }: { summary: AuditSummary }) {
  const { totals, runs } = summary;
  return (
    <>
      <div className="astats">
        <Tile label="Total cost">{cost(totals.costUsd, totals.costSource)}</Tile>
        <Tile label="Tokens">{formatTokens(totals.totalTokens)}</Tile>
        <Tile label="Tokens in">{formatTokens(totals.inputTokens)}</Tile>
        <Tile label="Tokens out">{formatTokens(totals.outputTokens)}</Tile>
        <Tile label="Cached reads">{formatTokens(totals.cachedReadTokens)}</Tile>
        <Tile label="Runs">{totals.runs}</Tile>
        <Tile label="Tool calls">{totals.toolCalls}</Tile>
        <Tile label="Active time">{formatDuration(totals.durationMs)}</Tile>
      </div>
      {totals.costSource && totals.costSource !== 'reported' && (
        <p className="aud-note">
          Costs marked ~ are estimates: tokens × the provider&apos;s published list price, because
          the provider did not report a cost. They are not a bill.
        </p>
      )}
      <AuditTable
        title="By model"
        head={['Model', 'Provider', 'Runs', 'In', 'Out', 'Cached', 'Thinking', 'Cost', 'Source']}
        numeric={[2, 3, 4, 5, 6, 7]}
        rows={summary.byModel.map((row) => ({
          key: `${row.provider}:${row.model ?? ''}`,
          cells: [
            <span className="who" key="m">
              <ProviderDot provider={row.provider} />
              {row.model ?? 'Default model'}
            </span>,
            providerLabel(row.provider),
            row.runs,
            tokens(row.inputTokens),
            tokens(row.outputTokens),
            tokens(row.cachedReadTokens),
            tokens(row.thoughtTokens),
            cost(row.costUsd, row.costSource),
            <SourceTag key="s" source={row.costSource} />,
          ],
        }))}
        foot={[
          'Total',
          '',
          totals.runs,
          tokens(totals.inputTokens),
          tokens(totals.outputTokens),
          tokens(totals.cachedReadTokens),
          tokens(totals.thoughtTokens),
          cost(totals.costUsd, totals.costSource),
          '',
        ]}
      />
      <AuditTable
        title="By role"
        head={['Role', 'Runs', 'Tokens', 'Cost', 'Active']}
        numeric={[1, 2, 3, 4]}
        rows={byRole(runs).map((row) => ({
          key: row.role,
          cells: [
            row.role,
            row.runs,
            tokens(row.totalTokens),
            cost(row.costUsd, row.costSource),
            formatDuration(row.durationMs),
          ],
        }))}
      />
      <AuditTable
        title="By category"
        head={['Category', 'Turns', 'Tokens', 'Cost', 'Share']}
        numeric={[1, 2, 3, 4]}
        rows={categoryBreakdown(runs).map((row) => ({
          key: row.category ?? 'none',
          cells: [
            categoryName(row.category),
            row.turns,
            tokens(row.totalTokens),
            cost(row.costUsd, row.costSource),
            share(row.costUsd, totals.costUsd),
          ],
        }))}
      />
      <AuditTable
        title="By provider"
        head={['Provider', 'Runs', 'Tokens', 'Cost', 'Share']}
        numeric={[1, 2, 3, 4]}
        rows={summary.byProvider.map((row) => ({
          key: row.provider,
          cells: [
            <span className="who" key="p">
              <ProviderDot provider={row.provider} />
              {providerLabel(row.provider)}
            </span>,
            row.runs,
            tokens(row.totalTokens),
            cost(row.costUsd, row.costSource),
            share(row.costUsd, totals.costUsd),
          ],
        }))}
      />
      <AuditTable
        title="By run"
        head={[
          '#',
          'Role',
          'Model',
          'Effort',
          'Status',
          'Tokens',
          'Cost',
          'Source',
          'Time',
          'Reads',
          'Adapter',
        ]}
        numeric={[0, 5, 6, 8, 9]}
        rows={runs.map((run, index) => ({
          key: run.runId,
          cells: [
            index + 1,
            <span className="who" key="r">
              <ProviderDot provider={run.provider} />
              {run.role}
            </span>,
            run.model ?? '—',
            run.effort ?? '—',
            run.status.replaceAll('_', ' '),
            tokens(run.totalTokens),
            cost(run.costUsd, run.costSource),
            <SourceTag key="s" source={run.costUsd === null ? null : run.costSource} />,
            formatDuration(run.durationMs),
            readsCell(run),
            adapterCell(run),
          ],
        }))}
      />
    </>
  );
}

function readsCell(run: AuditRunSummary): string {
  if (run.fileReads === undefined || run.fileReads === null) return '—';
  return `${run.fileReads}`;
}

function adapterCell(run: AuditRunSummary) {
  if (!run.adapter) return '—';
  const { name, version } = run.adapter;
  return (
    <span key="a" title={`${name} ${version}`}>
      {name.split('/').at(-1)} {version}
    </span>
  );
}
