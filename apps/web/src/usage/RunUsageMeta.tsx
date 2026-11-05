import { useId } from 'react';
import type { Run } from '@spark-outpost/contracts';
import { providerName } from '../chat/provider-name.ts';
import { ESTIMATE_TIP, formatCost, runUsageLine, tokenBreakdown } from './format.ts';
import './usage.css';

function detailLines(run: Run): string[] {
  const usage = run.usage;
  const lines: string[] = [];
  if (usage?.tokens) lines.push(tokenBreakdown(usage.tokens).join(' · '));
  if (usage?.costUsd == null) {
    lines.push(`${providerName(run.provider)} didn't report a cost`);
  } else if (usage.costSource === 'estimated') {
    lines.push(`Cost ${formatCost(usage.costUsd, 'estimated')} (estimated)`, ESTIMATE_TIP);
  } else {
    lines.push(`Cost ${formatCost(usage.costUsd)}, as reported by ${providerName(run.provider)}`);
  }
  const settings = [run.model, run.effort && `${run.effort} effort`].filter(Boolean);
  if (settings.length > 0) lines.push(settings.join(' · '));
  return lines;
}

export function RunUsageMeta({ run }: { run: Run }) {
  const tipId = useId();
  const line = runUsageLine(run.usage);
  if (!line) return null;
  return (
    <div className="run-meta">
      <span className="run-usage" tabIndex={0} aria-describedby={tipId}>
        {line}
        <span className="usage-tip" role="tooltip" id={tipId}>
          {detailLines(run).map((detail) => (
            <span key={detail}>{detail}</span>
          ))}
        </span>
      </span>
    </div>
  );
}
