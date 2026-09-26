import { useCallback, useEffect, useState } from 'react';
import { sceneChanges, type Chatter, type Handoff, type TvScene } from './tv-chatter.ts';

export interface Packet extends Handoff {
  key: string;
}

export interface TvEvents {
  chatter: Chatter | null;
  packets: Packet[];
  landed(key: string): void;
}

interface TvEventOptions {
  muted: boolean;
  reduced: boolean;
  paused: boolean;
}

const SHOW_MS = 3200;
const GAP_MS = 900;
const NEXT_MS = 60;
const QUEUE_LIMIT = 3;

function sceneKey(scene: TvScene): string {
  const agents = scene.agents.map((agent) => `${agent.id}:${agent.state}:${agent.line}`);
  return `${agents.join('|')}#${scene.decision ?? ''}`;
}

export function useTvEvents(scene: TvScene, { muted, reduced, paused }: TvEventOptions): TvEvents {
  const key = sceneKey(scene);
  const [seen, setSeen] = useState({ key, scene });
  const [packets, setPackets] = useState<Packet[]>([]);
  const [queue, setQueue] = useState<Chatter[]>([]);
  const [current, setCurrent] = useState<Chatter | null>(null);
  const [cooling, setCooling] = useState(false);

  if (seen.key !== key) {
    const changes = sceneChanges(seen.scene, scene);
    setSeen({ key, scene });
    if (!paused && !reduced && changes.handoffs.length > 0) {
      const fresh = changes.handoffs.map((handoff) => ({
        ...handoff,
        key: `${key}/${handoff.agentId}/${handoff.direction}`,
      }));
      setPackets((existing) => [...existing, ...fresh]);
    }
    if (!paused && !muted && changes.chatter.length > 0) {
      setQueue((existing) => [...existing, ...changes.chatter].slice(-QUEUE_LIMIT));
    }
  }
  if (muted && queue.length > 0) setQueue([]);

  useEffect(() => {
    if (current || cooling || queue.length === 0) return;
    const timer = setTimeout(() => {
      setCurrent(queue[0]!);
      setQueue((existing) => existing.slice(1));
    }, NEXT_MS);
    return () => clearTimeout(timer);
  }, [current, cooling, queue]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      setCurrent(null);
      setCooling(true);
    }, SHOW_MS);
    return () => clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    if (!cooling) return;
    const timer = setTimeout(() => setCooling(false), GAP_MS);
    return () => clearTimeout(timer);
  }, [cooling]);

  const landed = useCallback(
    (done: string) => setPackets((existing) => existing.filter((packet) => packet.key !== done)),
    [],
  );

  return { chatter: muted ? null : current, packets: reduced ? [] : packets, landed };
}
