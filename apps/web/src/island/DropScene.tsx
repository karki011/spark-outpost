import type { RefObject } from 'react';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import type { GrabItem, GrabPhase } from './use-island-drop.ts';

const WORDS: Record<GrabPhase, string> = {
  idle: '',
  enter: 'Drop to add to a new chat',
  over: 'Drop to add to a new chat',
  drop: 'Got it!',
  leave: 'Maybe next time',
  reject: 'Spark can’t take that one',
};

const MOODS: Record<GrabPhase, ScoutMood> = {
  idle: null,
  enter: null,
  over: null,
  drop: 'happy',
  leave: 'sad',
  reject: 'sad',
};

function Arm({ side }: { side: 'l' | 'r' }) {
  return (
    <g className={`isl-arm ${side}`}>
      <path className="isl-arm-line" d="M0 0 C 0 -9, 0 -16, 0 -22" />
      <g className="isl-hand">
        <path d="M-4.5 -22 a4.5 4.5 0 0 1 4.5 -4.5" />
        <path d="M4.5 -22 a4.5 4.5 0 0 0 -4.5 -4.5" />
      </g>
    </g>
  );
}

function ItemIcon({ item }: { item: GrabItem }) {
  if (item.preview) return <img src={item.preview} alt="" />;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {item.kind === 'folder' ? (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      ) : (
        <path d="M6 3h8l4 4v14H6zM14 3v4h4" />
      )}
    </svg>
  );
}

interface DropSceneProps {
  phase: GrabPhase;
  item: GrabItem | null;
  note: string | null;
  sceneRef: RefObject<HTMLDivElement | null>;
}

export function DropScene({ phase, item, note, sceneRef }: DropSceneProps) {
  return (
    <div
      ref={sceneRef}
      className="isl-drop"
      data-phase={phase}
      hidden={phase === 'idle'}
      role="status"
      aria-label={phase === 'idle' ? undefined : WORDS[phase]}
    >
      <div className="isl-drop-stage">
        <svg className="isl-arms" viewBox="-40 -34 80 40" aria-hidden="true">
          <Arm side="l" />
          <Arm side="r" />
        </svg>
        <span className="isl-drop-blob">
          <BlobScout
            size={56}
            mood={MOODS[phase]}
            lookAtPointer={phase === 'enter' || phase === 'over'}
          />
        </span>
        {item && (phase === 'drop' || phase === 'reject') && (
          <span className="isl-drop-item" data-kind={item.kind}>
            <ItemIcon item={item} />
          </span>
        )}
      </div>
      <strong>{WORDS[phase]}</strong>
      {phase === 'reject' && note && <span className="isl-drop-note">{note}</span>}
    </div>
  );
}
