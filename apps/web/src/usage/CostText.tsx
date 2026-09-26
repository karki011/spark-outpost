import './usage.css';
import { costNote, costTip, formatCost, type CostSourceLabel } from './format.ts';

interface CostTextProps {
  usd: number | null;
  source?: CostSourceLabel;
  empty?: string;
}

export function CostText({ usd, source, empty = '—' }: CostTextProps) {
  if (usd === null) return <span className="cost-text none">{empty}</span>;
  const note = costNote(source);
  return (
    <span className={note ? 'cost-text est' : 'cost-text'} title={costTip(source)}>
      {formatCost(usd, source)}
      {source === 'mixed' && <small className="cost-note"> includes estimates</small>}
      {source === 'estimated' && <span className="sr-only"> (estimated)</span>}
    </span>
  );
}
