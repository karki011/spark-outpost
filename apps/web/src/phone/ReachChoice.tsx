import './phone-reach.css';
import { useId } from 'react';
import { REMOTE_REACH_LABELS, type RemoteReach } from '@spark-outpost/contracts';
import { Segmented } from '../ui/Segmented.tsx';
import { REACH_CHOICE_LABEL } from './custom-domain.ts';

const OPTIONS = (['tailscale', 'custom'] as const).map((id) => ({
  id,
  label: REMOTE_REACH_LABELS[id],
}));

interface ReachChoiceProps {
  reach: RemoteReach;
  onChange: (reach: RemoteReach) => void;
}

export function ReachChoice({ reach, onChange }: ReachChoiceProps) {
  const labelId = useId();
  return (
    <div className="ph-reach">
      <span id={labelId} className="ph-reach-label">
        {REACH_CHOICE_LABEL}
      </span>
      <Segmented
        ariaLabel={REACH_CHOICE_LABEL}
        options={OPTIONS}
        value={reach}
        onChange={(id) => onChange(id === 'custom' ? 'custom' : 'tailscale')}
      />
    </div>
  );
}
