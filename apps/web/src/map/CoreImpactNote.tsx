import type { CoreImpact } from '@spark-outpost/contracts';
import { coreImpactText } from './map-model.ts';
import './core-impact.css';

export function CoreImpactNote({ impact }: { impact: CoreImpact | null | undefined }) {
  if (!impact) return null;
  return (
    <p className="core-note" title={impact.keyFiles.join('\n') || undefined}>
      <i className="core-note-dot" aria-hidden="true" />
      {coreImpactText(impact)}
    </p>
  );
}
