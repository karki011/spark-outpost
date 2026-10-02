import './permission-chip.css';
import type { Ref } from 'react';
import { AskIcon, EyeIcon, PenIcon, ShieldIcon, UnlockIcon } from '../../ui/icons.tsx';
import { useTooltip } from '../../ui/Tooltip.tsx';
import type { PermissionRisk, PermissionState } from './mode-summary.ts';

const RISK_ICONS: Readonly<Record<PermissionRisk, () => React.JSX.Element>> = {
  read: EyeIcon,
  ask: AskIcon,
  edit: PenIcon,
  auto: ShieldIcon,
  full: UnlockIcon,
};

export function PermissionIcon({ risk }: { risk: PermissionRisk }) {
  const Icon = RISK_ICONS[risk];
  return <Icon />;
}

interface PermissionChipProps {
  ref: Ref<HTMLButtonElement>;
  state: PermissionState;
  hint: string;
  expanded: boolean;
  panelId: string;
  onClick: () => void;
}

export function PermissionChip({
  ref,
  state,
  hint,
  expanded,
  panelId,
  onClick,
}: PermissionChipProps) {
  const { triggerProps, tooltip } = useTooltip(hint, { side: 'top' });
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`pchip risk-${state.risk}`}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-label={`Permissions: ${state.label}`}
        {...triggerProps}
        onClick={onClick}
      >
        <PermissionIcon risk={state.risk} />
        <span className="pchip-name">{state.short}</span>
      </button>
      {tooltip}
    </>
  );
}
