import { useState } from 'react';
import { countLabel } from '../ui/count-label.ts';
import { TeammateRoster } from '../teammates/TeammateRoster.tsx';
import { useTeammates } from '../teammates/use-teammates.ts';
import { ChevronIcon } from '../ui/icons.tsx';
import { readDetailsOpen, SPARKS_KEY, writeDetailsOpen } from './digest-details.ts';

interface SparksLineProps {
  now: number;
  onOpenId: (conversationId: string) => void;
}

export function sparksSummary(states: readonly string[]): string {
  const working = states.filter((state) => state === 'working').length;
  const idle = states.filter((state) => state === 'idle').length;
  const parts = [
    countLabel(states.length, 'Spark'),
    ...(working > 0 ? [`${working} working`] : []),
    ...(idle > 0 ? [`${idle} idle`] : []),
  ];
  return parts.join(' · ');
}

export function SparksLine({ now, onOpenId }: SparksLineProps) {
  const { loading, teammates } = useTeammates();
  const [open, setOpen] = useState(() => readDetailsOpen(SPARKS_KEY));
  return (
    <details
      className="hsparks"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        writeDetailsOpen(next, SPARKS_KEY);
      }}
    >
      <summary>
        <ChevronIcon />
        <span>
          {loading ? 'Sparks' : sparksSummary(teammates.map((teammate) => teammate.state))}
        </span>
      </summary>
      <TeammateRoster now={now} onOpenId={onOpenId} />
    </details>
  );
}
