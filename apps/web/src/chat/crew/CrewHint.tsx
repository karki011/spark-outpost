import type { ReactNode } from 'react';
import { crewTitle } from '@spark-outpost/contracts';
import { useTooltip } from '../../ui/Tooltip.tsx';

interface CrewHintProps {
  label: string;
  className?: string;
  children: ReactNode;
}

export function CrewHint({ label, className, children }: CrewHintProps) {
  const { triggerProps, tooltip } = useTooltip(label, { side: 'top' });
  return (
    <span className={className} {...triggerProps}>
      {children}
      {tooltip}
    </span>
  );
}

export function CrewName({ name }: { name: string }) {
  const title = crewTitle(name);
  if (title === name) return <span className="agent-name">{name}</span>;
  return (
    <CrewHint className="agent-name" label={title}>
      {name}
    </CrewHint>
  );
}
