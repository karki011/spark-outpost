import { useCallback, useEffect, useId, type CSSProperties } from 'react';
import { isBusy, type CrewAgent } from './crew-model.ts';
import { AskBubble, ChatBubble, DetailBubble } from './TvBubble.tsx';
import { TvNode } from './TvNode.tsx';
import type { Chatter } from './tv-chatter.ts';
import type { StageGaze, GazeAim } from './tv-gaze.ts';
import {
  bubbleBox,
  handoffPath,
  textWidth,
  stageLayout,
  type Seat,
  type StageLayout,
  type StageMetrics,
} from './tv-layout.ts';
import type { TvAsk } from './tv-scene.ts';

const PROVIDER_COLORS: Record<string, string> = {
  claude: 'var(--c-claude)',
  codex: 'var(--c-codex)',
  zai: 'var(--c-zai)',
};

function lineColor(provider: string): CSSProperties {
  return { '--lc': PROVIDER_COLORS[provider] ?? 'var(--accent)' } as CSSProperties;
}

function gazeAim(agent: CrewAgent, focus: string | null): GazeAim {
  if (agent.state === 'waiting') return 'rest';
  if (isBusy(agent.state)) return null;
  return focus && focus !== agent.id ? { blob: focus } : null;
}

export interface StageProps {
  members: readonly CrewAgent[];
  metrics: StageMetrics;
  asks: Record<string, TvAsk>;
  chatter: Chatter | null;
  gaze: StageGaze | null;
  reduced: boolean;
  selected: string | null;
  onSelect(id: string | null): void;
  onPick(id: string): void;
  onAsk(approvalId: string): void;
}

function seatOf(layout: StageLayout, crew: readonly CrewAgent[], id: string): Seat {
  const index = crew.findIndex((agent) => agent.id === id);
  return index < 0 ? layout.lead : layout.seats[index]!;
}

export function AgentTvStage(props: StageProps) {
  const { members, metrics, asks, chatter, gaze, reduced, selected } = props;
  const bubbleId = useId();
  const [lead, ...crew] = members;
  const layout = stageLayout(crew.length, metrics);
  const focus = members.find((member) => isBusy(member.state))?.id ?? null;
  const sizeOf = (id: string) => (lead?.id === id ? metrics.leadSize : metrics.crewSize);

  const attach = useCallback(
    (id: string, svg: SVGSVGElement | null) => {
      if (!gaze) return;
      if (svg) gaze.attach(id, svg);
      else gaze.detach(id);
    },
    [gaze],
  );
  const redraw = useCallback(() => gaze?.refresh(), [gaze]);

  useEffect(() => {
    if (!gaze) return;
    for (const member of members) gaze.aim(member.id, gazeAim(member, focus));
  });

  const go = (id: string) => {
    props.onSelect(null);
    props.onPick(id);
  };

  const box = (id: string, text?: string) =>
    bubbleBox(
      seatOf(layout, crew, id),
      sizeOf(id),
      metrics,
      id === lead?.id,
      text ? textWidth(text, metrics.fontSize) : undefined,
    );
  const selectedAgent = members.find((member) => member.id === selected);
  const talking = chatter && members.some((member) => member.id === chatter.agentId);
  const quietIds = new Set([selected, ...Object.keys(asks)]);

  const renderNode = (agent: CrewAgent, seat: Seat, index: number) => (
    <TvNode
      key={agent.id}
      agent={agent}
      seat={seat}
      size={sizeOf(agent.id)}
      index={index}
      lead={agent.id === lead?.id}
      selected={selected === agent.id}
      reduced={reduced}
      bubbleId={bubbleId}
      onBlob={attach}
      onRedraw={redraw}
      onSelect={props.onSelect}
      onGo={go}
    />
  );

  return (
    <div
      className="tv-stage"
      style={
        {
          width: metrics.width,
          height: metrics.height,
          '--lw': `${metrics.labelWidth}px`,
          '--fs': `${metrics.fontSize}px`,
          '--lead': `${metrics.leadSize}px`,
        } as CSSProperties
      }
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        gaze?.point({ x: event.clientX, y: event.clientY });
      }}
      onPointerLeave={() => gaze?.point(null)}
    >
      <i
        className="tv-spot"
        aria-hidden="true"
        style={{ left: layout.lead.x, height: layout.lead.y + metrics.leadSize * 0.42 }}
      />
      <i
        className="tv-floor"
        aria-hidden="true"
        style={{ left: layout.lead.x, top: layout.lead.y + metrics.leadSize * 0.42 }}
      />
      <svg
        className="tv-wires"
        width={metrics.width}
        height={metrics.height}
        viewBox={`0 0 ${metrics.width} ${metrics.height}`}
        aria-hidden="true"
      >
        {crew.map((member, index) => (
          <path
            key={member.id}
            className={`tv-l${isBusy(member.state) ? ' on' : ''}${member.state === 'queued' ? ' q' : ''}`}
            style={lineColor(member.provider)}
            d={handoffPath(layout.lead, layout.seats[index]!)}
          />
        ))}
      </svg>
      {lead && renderNode(lead, layout.lead, 0)}
      {crew.map((member, index) => renderNode(member, layout.seats[index]!, index + 1))}
      {members
        .filter((member) => asks[member.id] && member.id !== selected)
        .map((member) => (
          <AskBubble
            key={`ask-${member.id}`}
            box={box(member.id, asks[member.id]!.text)}
            agent={member}
            ask={asks[member.id]!}
            onAsk={props.onAsk}
          />
        ))}
      {talking && !quietIds.has(chatter.agentId) && (
        <ChatBubble
          key={chatter.text}
          box={box(chatter.agentId, chatter.text)}
          text={chatter.text}
        />
      )}
      {selectedAgent && (
        <DetailBubble
          id={bubbleId}
          box={box(selectedAgent.id)}
          agent={selectedAgent}
          ask={asks[selectedAgent.id]}
          onGo={() => go(selectedAgent.id)}
          onAsk={props.onAsk}
        />
      )}
    </div>
  );
}
