import { useId } from 'react';
import {
  categoryLabel,
  type AdviceSummary,
  type IntakeAnswer,
  type IntakeCall,
} from '@spark-outpost/contracts';
import { formatCost } from '../usage/format.ts';
import { formatTokens, shortLabel } from './composer/model-options.ts';
import { providerName } from './provider-name.ts';
import '../usage/usage.css';

function routeParts(answer: IntakeAnswer): string[] {
  const model = answer.modelLabel ? shortLabel(answer.modelLabel) : answer.model;
  return [model ?? `${providerName(answer.provider)} default`, answer.effort].filter(
    (part): part is string => Boolean(part),
  );
}

const CALLS: Record<string, [string, string]> = {
  question: ['answer only', 'make changes'],
  plan_only: ['plan only', 'no plan asked'],
  vague: ['vague', 'clear enough'],
  review: ['review wanted', 'no review asked'],
  destructive: ['destructive', 'not destructive'],
  continues_task: ['same task', 'new task'],
};

function callText(key: string, call: IntakeCall): string {
  const [yes, no] = CALLS[key] ?? [key, `not ${key}`];
  const jev = call.jev === null ? '' : ` ${call.jev.toFixed(2)}`;
  return `${call.value ? yes : no} (${call.source === 'jev' ? 'Jev' : 'rules'}${jev})`;
}

function headline(advice: AdviceSummary): string {
  const jev = advice.jev;
  if (!jev) {
    const reason = advice.jevStatus === 'timed_out' ? 'Jev timed out' : 'Jev unavailable';
    return `${reason} · used the fixed rules`;
  }
  const calls = Object.entries(advice.calls ?? {}).filter(([key]) => key !== 'vague');
  const [first] = calls;
  const head = first ? callText(...first) : categoryName(jev);
  const would = jev.modelLabel ?? jev.model;
  return `Jev: ${head}${would ? ` · would have used ${shortLabel(would)}` : ''}`;
}

function categoryName(jev: NonNullable<AdviceSummary['jev']>): string {
  return jev.intent ? categoryLabel(jev.intent) : 'no category';
}

export function adviceDetails(advice: AdviceSummary): string[] {
  const { jev, rules } = advice;
  if (!jev) return [advice.jevError ?? 'Jev did not answer.', 'The rules decided everything.'];
  const lines = [`Category ${categoryName(jev)}`];
  for (const [key, call] of Object.entries(advice.calls ?? {})) lines.push(callText(key, call));
  if (jev.injection !== null) {
    lines.push(`Attached text steering the agent: ${jev.injection.toFixed(2)}`);
  }
  if (jev.tier && advice.routeGate) {
    lines.push(
      `Jev would have used the ${jev.tier} tier (${advice.routeGate.confidence.toFixed(2)}), recorded only`,
    );
  }
  lines.push(`Rules ran: ${[providerName(rules.provider), ...routeParts(rules)].join(' · ')}`);
  const cost = advice.usage
    ? `${formatTokens(advice.usage.inputTokens)} tokens · ${formatCost(advice.usage.costUsd, 'estimated')}, estimated`
    : null;
  const latency = advice.latencyMs === null ? null : `${advice.latencyMs} ms`;
  lines.push(
    [latency, cost, advice.policyVersion ? `policy ${advice.policyVersion}` : null]
      .filter(Boolean)
      .join(' · '),
  );
  return lines.filter(Boolean);
}

export function AdviceLine({ advice }: { advice: AdviceSummary | undefined }) {
  const tipId = useId();
  if (!advice || advice.jevStatus === 'not_connected') return null;
  return (
    <div className="run-meta">
      <span className="run-usage" tabIndex={0} aria-describedby={tipId}>
        {headline(advice)}
        <span className="usage-tip" role="tooltip" id={tipId}>
          {adviceDetails(advice).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </span>
    </div>
  );
}
