import { useTooltip } from '../ui/Tooltip.tsx';
import { PanelIcon } from './TaskIcons.tsx';
import type { TaskPanel } from './work-panel-state.ts';

interface WorkPanelToggleProps {
  panel: TaskPanel;
  waiting?: boolean;
}

export function WorkPanelToggle({ panel, waiting: checkpoint = false }: WorkPanelToggleProps) {
  const tip = useTooltip(panel.open ? 'Hide work panel' : 'Show work panel');
  if (!panel.available) return null;
  const waiting = (checkpoint || (panel.task?.summary.waiting ?? 0) > 0) && !panel.open;
  return (
    <>
      <button
        type="button"
        className={waiting ? 'icon-btn wp-toggle alert' : 'icon-btn wp-toggle'}
        aria-pressed={panel.open}
        aria-controls="work-panel"
        aria-label={panel.open ? 'Hide work panel' : 'Show work panel'}
        {...tip.triggerProps}
        onClick={() => panel.setOpen(!panel.open)}
      >
        <PanelIcon />
      </button>
      {tip.tooltip}
    </>
  );
}
