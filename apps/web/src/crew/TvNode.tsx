import './piece-state.css';
import './tv-hub.css';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import { Blobatar } from 'blobatar/react';
import * as poses from 'blobatar/expression';
import { crewExpression, crewHue, isDispatcher, type CrewAgent } from './crew-model.ts';
import { crewSeed } from './CrewBlob.tsx';
import { roleSubtitle } from './tv-scene.ts';
import { pieceTagText, type PieceTag } from './tv-coordinator.ts';
import type { CrewSeat, Seat } from './tv-layout.ts';

export type TvMood =
  'idle' | 'thinking' | 'unsure' | 'happy' | 'sad' | 'sleepy' | 'surprised' | 'wink' | 'love';

const MOODS: Record<TvMood, poses.Expression> = {
  idle: poses.idle,
  thinking: poses.thinking,
  unsure: poses.unsure,
  happy: poses.happy,
  sad: poses.sad,
  sleepy: poses.sleepy,
  surprised: poses.surprised,
  wink: poses.wink,
  love: poses.love,
};

const SQUASH: Keyframe[] = [
  { transform: 'scale(1, 1)' },
  { transform: 'scale(1.22, 0.78) translateY(4%)' },
  { transform: 'scale(0.86, 1.18) translateY(-14%)' },
  { transform: 'scale(1.06, 0.95)' },
  { transform: 'scale(1, 1)' },
];
const SPIN: Keyframe[] = [{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }];
const WAVE: Keyframe[] = [
  { transform: 'rotate(0deg)' },
  { transform: 'rotate(-16deg)' },
  { transform: 'rotate(14deg)' },
  { transform: 'rotate(-10deg)' },
  { transform: 'rotate(6deg)' },
  { transform: 'rotate(0deg)' },
];

const MOOD_MS = 1400;

function hoverMood(agent: CrewAgent): TvMood | null {
  if (agent.state === 'done') return 'wink';
  if (agent.state === 'queued' || agent.state === 'stopped') return 'surprised';
  return null;
}

function PieceLines({ tag }: { tag: PieceTag }) {
  const title = `${tag.key} · ${tag.title}`;
  return (
    <>
      <small className="tv-piece" title={title}>
        {title}
      </small>
      <small className="tv-state">
        <span className="piece-state" data-state={tag.state}>
          {tag.state}
        </span>
      </small>
      <small className="tv-place" title={tag.place}>
        {tag.place}
      </small>
    </>
  );
}

interface TvNodeProps {
  agent: CrewAgent;
  seat: Seat | CrewSeat;
  size: number;
  index: number;
  tag: PieceTag | null;
  selected: boolean;
  reduced: boolean;
  bubbleId: string;
  onBlob(id: string, svg: SVGSVGElement | null): void;
  onRedraw(): void;
  onSelect(id: string): void;
  onGo(id: string): void;
}

export function TvNode(props: TvNodeProps) {
  const { agent, seat, size, index, tag, selected, reduced, bubbleId, onBlob, onRedraw } = props;
  const [mood, setMood] = useState<TvMood | null>(null);
  const [hovered, setHovered] = useState(false);
  const squash = useRef<HTMLSpanElement>(null);
  const jev = isDispatcher(agent);
  const subtitle = roleSubtitle(agent);

  const face = mood ?? (hovered ? hoverMood(agent) : null) ?? crewExpression(agent.state);
  const blobRef = useCallback(
    (svg: SVGSVGElement | null) => {
      onBlob(agent.id, svg);
      return () => onBlob(agent.id, null);
    },
    [agent.id, onBlob],
  );

  useEffect(() => onRedraw(), [face, onRedraw]);

  useEffect(() => {
    if (!mood) return;
    const timer = setTimeout(() => setMood(null), MOOD_MS);
    return () => clearTimeout(timer);
  }, [mood]);

  const play = (frames: Keyframe[], duration: number) => {
    if (reduced) return;
    squash.current?.animate(frames, { duration, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' });
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail >= 2) {
      setMood(jev ? 'love' : 'wink');
      play(jev ? SPIN : WAVE, jev ? 700 : 900);
      return;
    }
    if (selected) {
      props.onGo(agent.id);
      return;
    }
    setMood('happy');
    play(SQUASH, 620);
    props.onSelect(agent.id);
  };

  const out = 'outX' in seat ? seat : { outX: 0, outY: 0 };
  const style = {
    left: seat.x,
    top: seat.y,
    '--bs': `${size}px`,
    '--ox': out.outX,
    '--oy': out.outY,
    '--delay': `${(index * 0.07).toFixed(2)}s`,
    '--bob': `-${(index * 0.45).toFixed(2)}s`,
  } as CSSProperties;

  return (
    <button
      type="button"
      className={`tv-n ${agent.state}${jev ? ' jev' : ''}${selected ? ' sel' : ''}`}
      style={style}
      data-agent={agent.id}
      data-role={agent.role}
      data-piece={tag?.key}
      aria-label={`${agent.name}, ${tag ? pieceTagText(tag) : agent.line}. ${selected ? 'Go to in chat' : 'Show details'}`}
      aria-expanded={selected}
      aria-controls={selected ? bubbleId : undefined}
      onClick={click}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <span className="tv-b">
        {agent.state === 'waiting' && <span className="tv-ring" aria-hidden="true" />}
        <span className="tv-sq" ref={squash}>
          <Blobatar
            ref={blobRef}
            name={crewSeed(agent.name)}
            hue={crewHue(agent.provider)}
            size={size}
            animate="always"
            expression={MOODS[face]}
            className="crew-blob"
            aria-hidden="true"
          />
        </span>
        {tag && tag.notes > 0 && (
          <span className="tv-notes" aria-hidden="true">
            {tag.notes}
          </span>
        )}
        {agent.state === 'stopped' && (
          <span className="tv-z" aria-hidden="true">
            z<i>z</i>
          </span>
        )}
      </span>
      <b>{agent.name}</b>
      {tag ? (
        <PieceLines tag={tag} />
      ) : (
        <>
          {subtitle && <small className="tv-role">{subtitle}</small>}
          <small className="tv-line" title={agent.line}>
            <i />
            {agent.line}
          </small>
        </>
      )}
    </button>
  );
}
