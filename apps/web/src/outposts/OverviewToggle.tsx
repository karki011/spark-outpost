import { PanelIcon } from '../tasks/TaskIcons.tsx';
import { useTooltip } from '../ui/Tooltip.tsx';
import { countLabel } from '../ui/count-label.ts';

interface OverviewToggleProps {
  open: boolean;
  waiting: number;
  onToggle: () => void;
}

export function overviewToggleLabel(open: boolean, waiting: number): string {
  const action = open ? 'Hide Overview' : 'Show Overview';
  return waiting > 0 ? `${action}. ${countLabel(waiting, 'thread')} waiting on you` : action;
}

export function OverviewToggle({ open, waiting, onToggle }: OverviewToggleProps) {
  const tip = useTooltip(open ? 'Hide Overview' : 'Show Overview');
  return (
    <>
      {tip.tooltip}
      <button
        type="button"
        className="icon-btn op-overview-toggle"
        aria-label={overviewToggleLabel(open, waiting)}
        aria-pressed={open}
        {...tip.triggerProps}
        onClick={onToggle}
      >
        <PanelIcon />
        {waiting > 0 && <i className="op-overview-dot" aria-hidden="true" />}
      </button>
    </>
  );
}
