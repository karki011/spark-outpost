import '../../crew/agent-tv-stage.css';
import { motion } from 'motion/react';
import { AgentTvStage } from '../../crew/AgentTvStage.tsx';
import { openAgentTv } from '../../crew/agent-tv-store.ts';
import { busyCount, type CrewAgent } from '../../crew/crew-model.ts';
import { tvCaption } from '../../crew/tv-caption.ts';
import type { StageMetrics } from '../../crew/tv-layout.ts';
import { useReducedMotion } from '../../ui/motion.ts';
import { reveal } from '../../ui/transitions.tsx';
import { usePageHidden } from '../../ui/use-page-hidden.ts';

const DOCK_STAGE: StageMetrics = {
  width: 200,
  height: 128,
  jevSize: 34,
  crewSize: 26,
  labelWidth: 62,
  fontSize: 11,
};
const NO_ASKS = {};
const NO_PACKETS: never[] = [];
const ignore = () => undefined;

interface RailTvProps {
  conversationId: string;
  agents: readonly CrewAgent[];
}

function openLabel(agents: readonly CrewAgent[]): string {
  const busy = busyCount(agents);
  if (busy === 0) return 'Open Agent TV';
  return `Open Agent TV. ${busy} ${busy === 1 ? 'agent' : 'agents'} working`;
}

export function RailTv({ conversationId, agents }: RailTvProps) {
  const reduced = useReducedMotion();
  const hidden = usePageHidden();
  const caption = tvCaption(agents);
  const classes = ['crail-tv', hidden && 'paused', reduced && 'still'].filter(Boolean).join(' ');
  return (
    <motion.div
      className={classes}
      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : 8 }}
      transition={reveal}
    >
      <div className="crail-tv-stage" inert aria-hidden="true">
        <AgentTvStage
          members={agents}
          metrics={DOCK_STAGE}
          asks={NO_ASKS}
          decision={null}
          chatter={null}
          packets={NO_PACKETS}
          gaze={null}
          tags={null}
          reduced={reduced}
          selected={null}
          onSelect={ignore}
          onLanded={ignore}
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
