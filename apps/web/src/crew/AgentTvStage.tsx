import { useCallback, useEffect, useId, type CSSProperties } from 'react';
import { isBusy, isDispatcher, type CrewAgent } from './crew-model.ts';
import { AskBubble, ChatBubble, DetailBubble } from './TvBubble.tsx';
import { TvNode } from './TvNode.tsx';
import type { Chatter } from './tv-chatter.ts';
import type { StageGaze, GazeAim } from './tv-gaze.ts';
import type { PieceTag } from './tv-coordinator.ts';
import {
  bubbleBox,
  handoffPath,
  hubLayout,
  textWidth,
  stageLayout,
  type Seat,
  type StageLayout,
  type StageMetrics,
} from './tv-layout.ts';
import type { TvAsk } from './tv-scene.ts';
import type { Packet } from './use-tv-events.ts';

const PROVIDER_COLORS: Record<string, string> = {
  claude: 'var(--c-claude)',
  codex: 'var(--c-codex)',
  zai: 'var(--c-zai)',
  jev: 'var(--c-jev)',
};

function lineColor(provider: string): CSSProperties {
  return { '--lc': PROVIDER_COLORS[provider] ?? 'var(--accent)' } as CSSProperties;
}

function gazeAim(agent: CrewAgent, focus: string | null): GazeAim {
  if (agent.state === 'waiting') return 'rest';
  if (isBusy(agent.state) && !isDispatcher(agent)) return null;
  return focus && focus !== agent.id ? { blob: focus } : null;
}

export interface StageProps {
  members: readonly CrewAgent[];
  metrics: StageMetrics;
  asks: Record<string, TvAsk>;
  decision: string | null;
  chatter: Chatter | null;
  packets: readonly Packet[];
  gaze: StageGaze | null;
  tags: Record<string, PieceTag> | null;
  reduced: boolean;
  selected: string | null;
  onSelect(id: string | null): void;
  onLanded(key: string): void;
  onPick(id: string): void;
  onAsk(approvalId: string): void;
}

function seatOf(layout: StageLayout, crew: readonly CrewAgent[], id: string): Seat {
  const index = crew.findIndex((agent) => agent.id === id);
  return index < 0 ? layout.jev : layout.seats[index]!;
}

export function AgentTvStage(props: StageProps) {
  const { members, metrics, asks, chatter, gaze, tags, reduced, selected } = props;
  const bubbleId = useId();
  const jev = members.find(isDispatcher);
  const crew = members.filter((member) => !isDispatcher(member));
  const layout = tags ? hubLayout(crew.length, metrics) : stageLayout(crew.length, metrics);
  const focus = crew.find((member) => isBusy(member.state))?.id ?? null;
  const sizeOf = (id: string) => (jev?.id === id ? metrics.jevSize : metrics.crewSize);

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
      id === jev?.id,
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
      tag={tags?.[agent.id] ?? null}
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
      className={tags ? 'tv-stage hub' : 'tv-stage'}
      style={
        {
          width: metrics.width,
          height: metrics.height,
          '--lw': `${metrics.labelWidth}px`,
          '--fs': `${metrics.fontSize}px`,
          '--jev': `${metrics.jevSize}px`,
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
        style={{ left: layout.jev.x, height: layout.jev.y + metrics.jevSize * 0.42 }}
      />
      <i
        className="tv-floor"
        aria-hidden="true"
        style={{ left: layout.jev.x, top: layout.jev.y + metrics.jevSize * 0.42 }}
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
            d={handoffPath(layout.jev, layout.seats[index]!)}
          />
        ))}
      </svg>
      {props.packets.map((packet) => {
        const agent = crew.find((member) => member.id === packet.agentId);
        if (!agent) return null;
        const seat = seatOf(layout, crew, agent.id);
        const [from, to] = packet.direction === 'out' ? [layout.jev, seat] : [seat, layout.jev];
        return (
          <i
            key={packet.key}
            className={`tv-pk ${packet.direction}`}
            aria-hidden="true"
            style={{ ...lineColor(agent.provider), offsetPath: `path('${handoffPath(from, to)}')` }}
            onAnimationEnd={() => props.onLanded(packet.key)}
          />
        );
      })}
      {jev && renderNode(jev, layout.jev, 0)}
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
          decision={isDispatcher(selectedAgent) ? props.decision : null}
          ask={asks[selectedAgent.id]}
          onGo={() => go(selectedAgent.id)}
          onAsk={props.onAsk}
        />
      )}
    </div>
  );
}
