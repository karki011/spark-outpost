import './pull-requests.css';
import { useQuery } from '@tanstack/react-query';
import { useTooltip } from '../../ui/Tooltip.tsx';
import { PullRequestIcon } from '../rail/RailIcons.tsx';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { chipSummary, CI_LABELS, CI_TONES } from './pull-request-model.ts';

interface PrChipProps {
  conversationId: string;
  onOpen: (() => void) | null;
}

export function PrChip({ conversationId, onOpen }: PrChipProps) {
  const watches = useQuery(prWatchesQuery(conversationId));
  const summary = chipSummary(watches.data?.watches ?? []);
  const tip = useTooltip(summary ? CI_LABELS[summary.ci] : '');
  if (!summary) return null;
  const body = (
    <>
      <PullRequestIcon />
      <span>{summary.text}</span>
      <span className={`prchip-dot ${CI_TONES[summary.ci]}`} aria-hidden="true" />
    </>
  );
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          className="dchip prchip"
          aria-label={`${summary.label}. Show in Links`}
          {...tip.triggerProps}
          onClick={onOpen}
        >
          {body}
        </button>
      ) : (
        <a
          className="dchip prchip"
          href={summary.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${summary.label}. Opens on GitHub`}
          {...tip.triggerProps}
        >
          {body}
        </a>
      )}
      {tip.tooltip}
    </>
  );
}
