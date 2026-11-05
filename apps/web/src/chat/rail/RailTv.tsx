import '../../crew/agent-tv-stage.css';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { AgentTvStage } from '../../crew/AgentTvStage.tsx';
import { openAgentTv } from '../../crew/agent-tv-store.ts';
import { crewStateWord, type CrewAgent } from '../../crew/crew-model.ts';
import { tvCaption } from '../../crew/tv-caption.ts';
import { dockStage } from '../../crew/tv-layout.ts';
import { useReducedMotion } from '../../ui/motion.ts';
import { reveal } from '../../ui/transitions.tsx';
import { usePageHidden } from '../../ui/use-page-hidden.ts';

const NO_ASKS = {};
const ignore = () => undefined;

interface RailTvProps {
  conversationId: string;
  agents: readonly CrewAgent[];
}

function openLabel(agents: readonly CrewAgent[]): string {
  if (agents.length === 0) return 'Open Agent TV';
  return `Open Agent TV. ${agents.map((agent) => `${agent.name}: ${crewStateWord(agent.state)}`).join('. ')}`;
}

function useDockStage(workerCount: number) {
  const dock = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = dock.current;
    if (!element || typeof ResizeObserver !== 'function') return;
    const measure = () => setRoom(Math.round(element.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const metrics = useMemo(() => dockStage(room, workerCount), [room, workerCount]);
  return { dock, metrics };
}

export function RailTv({ conversationId, agents }: RailTvProps) {
  const reduced = useReducedMotion();
  const hidden = usePageHidden();
  const caption = tvCaption(agents.slice(0, 1));
  const { dock, metrics } = useDockStage(Math.max(0, agents.length - 1));
  const classes = ['crail-tv', hidden && 'paused', reduced && 'still'].filter(Boolean).join(' ');
  return (
    <motion.div
      ref={dock}
      className={classes}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={reveal}
    >
      <div className="crail-tv-stage" inert aria-hidden="true">
        <AgentTvStage
          members={agents}
          metrics={metrics}
          asks={NO_ASKS}
          chatter={null}
          gaze={null}
          reduced={reduced}
          selected={null}
          onSelect={ignore}
          onPick={ignore}
          onAsk={ignore}
        />
      </div>
      <p className="crail-tv-cap">
        {caption.lead && <b>{caption.lead}</b>} {caption.text}
      </p>
      <button
        type="button"
        className="crail-tv-open"
        aria-label={openLabel(agents)}
        onClick={() => openAgentTv(conversationId)}
      />
    </motion.div>
  );
}
