import { useQuery } from '@tanstack/react-query';
import { faceFromName } from '@spark-outpost/contracts';
import { TeammateFace } from '../../teammates/TeammateFace.tsx';
import { FALLBACK_RELAY_NAME, useRelay } from '../../teammates/use-relay.ts';
import { prWatchesQuery } from './pr-follow-up-api.ts';
import { outcomesIn, turnOutcomeLine } from './relay-model.ts';

function RelayFace({ size }: { size: number }) {
  const relay = useRelay();
  return <TeammateFace face={relay?.face ?? faceFromName(FALLBACK_RELAY_NAME)} size={size} />;
}

export function RelayRoundHeader() {
  const relay = useRelay();
  return (
    <p className="relay-round-head">
      <RelayFace size={16} />
      <b>{relay?.name ?? FALLBACK_RELAY_NAME}</b>
      <span>sent this follow-up round; you did not type it</span>
    </p>
  );
}

interface RelayRoundLinesProps {
  conversationId: string;
  runIds: readonly string[];
}

export function RelayRoundLines({ conversationId, runIds }: RelayRoundLinesProps) {
  const relay = useRelay();
  const outcomes = useQuery({
    ...prWatchesQuery(conversationId),
    select: (list) => outcomesIn(list.watches, runIds),
    notifyOnChangeProps: ['data'],
  }).data;
  if (!outcomes || outcomes.length === 0) return null;
  const name = relay?.name ?? FALLBACK_RELAY_NAME;
  return (
    <>
      {outcomes.map((item) => (
        <p key={item.key} className="ai-note relay-round-line">
          <RelayFace size={16} />
          {turnOutcomeLine(name, item)}
        </p>
      ))}
    </>
  );
}
