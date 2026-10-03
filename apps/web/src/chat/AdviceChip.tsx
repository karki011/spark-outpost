import { useId } from 'react';
import {
  categoryLabel,
  type AdviceSummary,
  type Category,
  type IntakeAnswer,
  type IntakeCall,
} from '@spark-outpost/contracts';
import { CategoryChip } from '../categories/CategoryChip.tsx';
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

function withoutStop(text: string): string {
  return text.trim().replace(/\.$/, '');
}

export function jevMissing(advice: AdviceSummary): string {
  switch (advice.jevStatus) {
    case 'timed_out':
      return 'Jev timed out';
    case 'failed':
      return 'Jev failed';
    case 'not_connected':
      return 'Jev not connected';
    default:
      return advice.jevError ? `Jev not asked: ${withoutStop(advice.jevError)}` : 'Jev not asked';
  }
}

function missingDetail(advice: AdviceSummary): string {
  const failed = advice.jevStatus === 'failed' || advice.jevStatus === 'timed_out';
  if (failed) return advice.jevError ?? 'Jev did not answer.';
  return `${jevMissing(advice)}.`;
}

function headline(advice: AdviceSummary): string {
  const jev = advice.jev;
  if (!jev) return `${jevMissing(advice)} · used the fixed rules`;
  const calls = Object.entries(advice.calls ?? {}).filter(([key]) => key !== 'vague');
  const [first] = calls;
  const head = first ? callText(...first) : categoryName(jev);
  const would = jev.modelLabel ?? jev.model;
  return `Jev: ${head}${would ? ` · would have used ${shortLabel(would)}` : ''}`;
}

function categoryName(jev: NonNullable<AdviceSummary['jev']>): string {
  return jev.intent ? categoryLabel(jev.intent) : 'no category';
}

export function adviceDetails(advice: AdviceSummary, { recordedRoute = true } = {}): string[] {
  const { jev, rules } = advice;
  if (!jev) return [missingDetail(advice), 'The rules decided everything.'];
  const lines = [`Category ${categoryName(jev)}`];
  for (const [key, call] of Object.entries(advice.calls ?? {})) lines.push(callText(key, call));
  if (jev.injection !== null) {
    lines.push(`Attached text steering the agent: ${jev.injection.toFixed(2)}`);
  }
  if (recordedRoute && jev.tier && advice.routeGate) {
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

interface AdviceChipProps {
  category: Category | null | undefined;
  advice: AdviceSummary | undefined;
}

function chipLabel(category: Category | null | undefined, advice: AdviceSummary): string {
  if (category) return categoryLabel(category);
  return advice.jev ? categoryName(advice.jev) : 'Rules';
}

export function AdviceChip({ category, advice }: AdviceChipProps) {
  const tipId = useId();
  if (!advice || advice.jevStatus === 'not_connected') return <CategoryChip category={category} />;
  return (
    <span className="cat-chip advice" tabIndex={0} aria-describedby={tipId}>
      {chipLabel(category, advice)}
      <span className="usage-tip" role="tooltip" id={tipId}>
        <b>{headline(advice)}</b>
        {adviceDetails(advice).map((line) => (
          <span key={line}>{line}</span>
        ))}
      </span>
    </span>
  );
}
