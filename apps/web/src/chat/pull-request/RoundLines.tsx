import { useQuery } from '@tanstack/react-query';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { outcomesIn, turnOutcomeLine } from './round-model.ts';

export function RoundHeader() {
  return (
    <p className="pr-round-head">
      <b>Follow-up</b>
      <span>sent this round; you did not type it</span>
    </p>
  );
}

interface RoundLinesProps {
  conversationId: string;
  runIds: readonly string[];
}

export function RoundLines({ conversationId, runIds }: RoundLinesProps) {
  const outcomes = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => outcomesIn(list.watches, runIds),
    notifyOnChangeProps: ['data'],
  }).data;
  if (!outcomes || outcomes.length === 0) return null;
  return (
    <>
      {outcomes.map((item) => (
        <p key={item.key} className="ai-note pr-round-line">
          {turnOutcomeLine(item)}
        </p>
      ))}
    </>
  );
}
