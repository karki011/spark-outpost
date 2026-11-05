import { useEffect, useState } from 'react';
import type { CrewAgent } from './crew-model.ts';
import { nextChatter, sceneChatter, trimChatter, type Chatter } from './tv-chatter.ts';

interface TvEventOptions {
  muted: boolean;
  paused: boolean;
  asking: readonly string[];
}

const SHOW_MS = 3200;
const GAP_MS = 900;
const NEXT_MS = 60;
const QUEUE_LIMIT = 3;

function sceneKey(agents: readonly CrewAgent[]): string {
  return agents.map((agent) => `${agent.id}:${agent.state}:${agent.line}`).join('|');
}

export function useTvChatter(
  agents: readonly CrewAgent[],
  { muted, paused, asking }: TvEventOptions,
): Chatter | null {
  const key = sceneKey(agents);
  const askingKey = asking.join(' ');
  const [seen, setSeen] = useState({ key, agents });
  const [queue, setQueue] = useState<Chatter[]>([]);
  const [current, setCurrent] = useState<Chatter | null>(null);
  const [cooling, setCooling] = useState(false);

  if (seen.key !== key) {
    const chatter = sceneChatter(seen.agents, agents);
    setSeen({ key, agents });
    if (!paused && !muted && chatter.length > 0) {
      setQueue((existing) => trimChatter([...existing, ...chatter], QUEUE_LIMIT));
    }
  }
  if (muted && queue.length > 0) setQueue([]);

  useEffect(() => {
    if (current || cooling || queue.length === 0) return;
    const timer = setTimeout(() => {
      const { line, rest } = nextChatter(queue, new Set(askingKey.split(' ')));
      setCurrent(line);
      setQueue(rest);
    }, NEXT_MS);
    return () => clearTimeout(timer);
  }, [current, cooling, queue, askingKey]);

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

  return muted ? null : current;
}
