import { useId } from 'react';
import {
  categoryLabel,
  depthLabel,
  scopeLabel,
  type AdviceSummary,
  type Gate,
  type GateDecision,
  type IntakeAnswer,
} from '@spark-outpost/contracts';
import { formatCost } from '../usage/format.ts';
import { formatTokens, shortLabel } from './composer/model-options.ts';
import { providerName } from './provider-name.ts';
import '../usage/usage.css';

const WOULD: Record<GateDecision, string> = {
  act: 'would use this',
  ask: 'would ask you first',
  fallback: 'would fall back to the fixed rules',
};

function gateLine(gate: Gate): string {
  return `${gate.confidence.toFixed(2)}: ${WOULD[gate.decision]} (acts at ${gate.actAt})`;
}

function routeParts(answer: IntakeAnswer): string[] {
  const model = answer.modelLabel ? shortLabel(answer.modelLabel) : answer.model;
  return [model ?? `${providerName(answer.provider)} default`, answer.effort].filter(
    (part): part is string => Boolean(part),
  );
}

function headline(advice: AdviceSummary): string {
  const jev = advice.jev;
  if (!jev) {
    const reason = advice.jevStatus === 'timed_out' ? 'Jev timed out' : 'Jev unavailable';
    return `${reason} · used the fixed rules`;
  }
  return [
    'Jev suggested',
    [...routeParts(jev), depthLabel(jev.depth), jev.confidence.toFixed(2)].join(' · '),
  ].join(' ');
}

export function adviceDetails(advice: AdviceSummary): string[] {
  const { jev, rules, gate } = advice;
  if (!jev) return [advice.jevError ?? 'Jev did not answer.', 'The chat’s own settings ran.'];
  const lines = [
    [
      `Category ${jev.intent ? categoryLabel(jev.intent) : 'unknown'}`,
      jev.complexity === null ? null : `complexity ${jev.complexity.toFixed(1)} of 3`,
      jev.scope ? `scope ${scopeLabel(jev.scope)}` : null,
      `risk ${jev.risk}`,
    ]
      .filter(Boolean)
      .join(' · '),
  ];
  if (jev.injection !== null) {
    lines.push(`Attached text steering the agent: ${jev.injection.toFixed(2)}`);
  }
  if (gate) lines.push(`Intake confidence ${gateLine(gate)}`);
  if (advice.routeGate) lines.push(`Model pick confidence ${gateLine(advice.routeGate)}`);
  const rulesRoute = [providerName(rules.provider), ...routeParts(rules), depthLabel(rules.depth)];
  lines.push(`Fixed rules: ${rulesRoute.join(' · ')}`);
  lines.push(
    advice.differences.length > 0
      ? `Differs from the rules on ${advice.differences.join(', ')}`
      : 'Same as the rules',
  );
  const cost = advice.usage
    ? `${formatTokens(advice.usage.inputTokens)} tokens · ${formatCost(advice.usage.costUsd, 'estimated')}, estimated`
    : null;
  const latency = advice.latencyMs === null ? null : `${advice.latencyMs} ms`;
  lines.push([latency, cost].filter(Boolean).join(' · '));
  lines.push('Recorded only: the chat’s own settings ran.');
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
