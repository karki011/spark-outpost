import './usage.css';
import { compactCost, costNote, costTip, formatCost, type CostSourceLabel } from './format.ts';

interface CostTextProps {
  usd: number | null;
  source?: CostSourceLabel;
  empty?: string;
  compact?: boolean;
}

export function CostText({ usd, source, empty = '—', compact = false }: CostTextProps) {
  if (usd === null) return <span className="cost-text none">{empty}</span>;
  const note = costNote(source);
  return (
    <span className={note ? 'cost-text est' : 'cost-text'} title={costTip(source)}>
      {compact ? compactCost(usd, source) : formatCost(usd, source)}
      {source === 'mixed' && !compact && <small className="cost-note"> includes estimates</small>}
      {note && (compact || source === 'estimated') && <span className="sr-only"> ({note})</span>}
    </span>
  );
}
