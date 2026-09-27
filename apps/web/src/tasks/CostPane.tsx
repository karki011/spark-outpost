import './cost-pane.css';
import type { Run, TaskDetail } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { formatTokens } from '../chat/composer/model-options.ts';
import { CrewBlob } from '../crew/CrewBlob.tsx';
import type { CrewAgent } from '../crew/crew-model.ts';
import { CostText } from '../usage/CostText.tsx';
import { formatCost } from '../usage/format.ts';
import { costSummary, runIdentities, type CostRow, type CostSlice } from './cost-model.ts';
import { useModelNamer } from './model-names.ts';

const PROVIDER_COLORS: Record<string, string> = {
  claude: 'var(--c-claude)',
  codex: 'var(--c-codex)',
  zai: 'var(--c-zai)',
  jev: 'var(--c-jev)',
};
const TIER_SHARE = [36, 62, 100];

export function sliceColor(slice: Pick<CostSlice, 'provider' | 'tier'>): string {
  const base = PROVIDER_COLORS[slice.provider] ?? 'var(--muted)';
  const share = slice.tier === null ? 100 : (TIER_SHARE[slice.tier] ?? 100);
  return share === 100 ? base : `color-mix(in srgb, ${base} ${share}%, var(--panel))`;
}

function CostBar({ slices, total }: { slices: readonly CostSlice[]; total: number }) {
  const label = slices.map((slice) => `${slice.label} ${formatCost(slice.costUsd)}`).join(', ');
  return (
    <>
      <div className="cost-bar" role="img" aria-label={`Cost by model: ${label}`}>
        {slices.map((slice) => (
          <i
            key={slice.key}
            style={{
              width: `max(3px, ${(slice.costUsd / total) * 100}%)`,
              background: sliceColor(slice),
            }}
          />
        ))}
      </div>
      <ul className="cost-legend" aria-label="Cost by model">
        {slices.map((slice) => (
          <li key={slice.key}>
            <i style={{ background: sliceColor(slice) }} />
            <span>{slice.label}</span>
            <b>{formatCost(slice.costUsd)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function RowBlob({ row }: { row: CostRow }) {
  if (row.crew) return <CrewBlob name={row.name} provider={row.provider} state="done" size={22} />;
  return <AgentBlob provider={row.provider} size={22} />;
}

function rowDetail(row: CostRow): string {
  const unit = row.provider === 'jev' ? 'calls' : 'turns';
  const turns = row.turns > 1 ? `${row.turns} ${unit}` : null;
  const role = row.role === row.name ? null : row.role;
  return [role, row.model, turns].filter(Boolean).join(' · ');
}

function sourceTip(row: CostRow): string {
  if (row.source === 'mixed') return 'Includes estimated costs';
  return 'Reported by the provider';
}

function AgentRow({ row }: { row: CostRow }) {
  return (
    <li className="cost-row">
      <span className="cost-ava" aria-hidden="true">
        <RowBlob row={row} />
      </span>
      <span className="cost-who">
        <b>{row.name}</b>
        <span>{rowDetail(row)}</span>
        {row.estimated && <span className="cost-est">estimated</span>}
      </span>
      <span className="cost-eff">{row.effort ?? ''}</span>
      <span className="cost-num">{row.tokens === null ? '—' : formatTokens(row.tokens)}</span>
      <span className="cost-num cost-usd">
        <CostText usd={row.costUsd} source={row.source} />
        {!row.estimated && row.costUsd !== null ? (
          <i className="cost-dot" title={sourceTip(row)} aria-label={sourceTip(row)} />
        ) : (
          <i className="cost-dot none" aria-hidden="true" />
        )}
      </span>
    </li>
  );
}

interface CostPaneProps {
  task: TaskDetail;
  runs?: readonly Run[];
  agents?: readonly CrewAgent[];
  onAudit?: (() => void) | undefined;
}

export function CostPane({ task, runs = [], agents = [], onAudit }: CostPaneProps) {
  const modelName = useModelNamer(task.runs.map((run) => run.provider));
  const identities = runIdentities(task, runs, agents);
  const dispatcher = agents.find((agent) => agent.role === 'jev') ?? null;
  const summary = costSummary({ task, runs, identities, modelName, dispatcher });
  const estimated = summary.rows.some(
    (row) => row.source === 'estimated' || row.source === 'mixed',
  );
  const split = summary.split;
  return (
    <div className="wsec cost-pane">
      <div className="cost-total">
        <b>
          <CostText usd={summary.costUsd} source={summary.source} empty="$0.00" />
        </b>
        <span>
          {summary.tokens === null
            ? 'No usage reported yet'
            : `${formatTokens(summary.tokens)} tokens`}
        </span>
      </div>
      {split && (
        <p className="cost-split">
          <span>
            In <b>{formatTokens(split.input)}</b>
          </span>
          <span>
            Out <b>{formatTokens(split.output)}</b>
          </span>
          <span>
            Cached <b>{formatTokens(split.cached)}</b>
          </span>
        </p>
      )}
      {summary.slices.length > 0 && summary.costUsd !== null && summary.costUsd > 0 && (
        <CostBar slices={summary.slices} total={summary.costUsd} />
      )}
      <div className="wsec-h cost-h">
        <h3>By agent</h3>
        {onAudit && (
          <button type="button" className="cost-audit" onClick={onAudit}>
            View in audit
          </button>
        )}
      </div>
      {summary.rows.length === 0 ? (
        <p className="wnote first">No usage reported yet.</p>
      ) : (
        <ul className="cost-rows" aria-label="Cost by agent">
          {summary.rows.map((row) => (
            <AgentRow key={row.key} row={row} />
          ))}
        </ul>
      )}
      <p className="wnote">
        {estimated
          ? 'Costs marked ~ are estimates: tokens × the published list price, for providers that report tokens only. The rest are what each provider reported.'
          : 'Costs are what each provider reported for its turns in this task.'}
      </p>
    </div>
  );
}
