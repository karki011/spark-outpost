import { autonomyLabel, type InvolvementLevel } from '@spark-outpost/contracts';
import { ShieldIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';

export interface AutonomyControl {
  level: InvolvementLevel;
  onOpen: () => void;
}

export function AutonomyChip({ level, onOpen }: AutonomyControl) {
  const label = autonomyLabel(level);
  const tip = useTooltip('Spark autonomy', { side: 'top' });
  return (
    <>
      <button
        type="button"
        className="ctx-autonomy"
        aria-label={`Spark autonomy: ${label}`}
        aria-controls="work-panel"
        {...tip.triggerProps}
        onClick={onOpen}
      >
        <ShieldIcon />
        <span className="ctx-autonomy-name">{label}</span>
      </button>
      {tip.tooltip}
    </>
  );
}
