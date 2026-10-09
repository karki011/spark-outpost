import './refresh-pull.css';
import { RefreshIcon, SpinnerIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import type { PullRefresh } from './use-pull-refresh.ts';

interface RefreshPullButtonProps {
  number: number;
  refresh: PullRefresh;
}

export function RefreshPullButton({ number, refresh }: RefreshPullButtonProps) {
  const tip = useTooltip(refresh.busy ? 'Reading from GitHub…' : 'Refresh from GitHub');
  return (
    <>
      <button
        type="button"
        className="pr-refresh"
        aria-label={`Refresh pull request #${number}`}
        aria-busy={refresh.busy}
        aria-disabled={refresh.busy}
        {...tip.triggerProps}
        onClick={refresh.refresh}
      >
        {refresh.busy ? <SpinnerIcon /> : <RefreshIcon />}
      </button>
      {tip.tooltip}
    </>
  );
}
