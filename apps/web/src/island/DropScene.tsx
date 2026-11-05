import { useEffect, useRef, type RefObject } from 'react';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import type { Grab, GrabItem, GrabOutcome, GrabPhase } from './use-island-drop.ts';

const MOODS: Record<GrabPhase, ScoutMood> = {
  idle: null,
  enter: null,
  over: null,
  drop: null,
  chew: 'working',
  choose: null,
  done: 'happy',
  leave: 'sad',
  reject: 'sad',
};

const DONE_WORDS: Record<GrabOutcome, (name: string, replying: boolean) => string> = {
  files: (_name, replying) => (replying ? 'Added to your reply' : 'Added to a new chat'),
  project: (name) => `${name} is a project now`,
  chat: (name) => `New chat in ${name}`,
};

function words(phase: GrabPhase, grab: Grab, replyingTo: string | null): string {
  const name = grab.item?.name ?? 'It';
  switch (phase) {
    case 'idle':
      return '';
    case 'enter':
    case 'over':
      return replyingTo ? 'Drop to add to your reply' : 'Drop to add to a new chat';
    case 'drop':
      return 'Got it!';
    case 'chew':
      return 'Having a look…';
    case 'choose':
      return `${name} is a folder`;
    case 'done':
      return grab.outcome ? DONE_WORDS[grab.outcome](name, replyingTo !== null) : 'Done';
    case 'leave':
      return 'Maybe next time';
    case 'reject':
      return 'Spark can’t take that one';
  }
}

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

function Carried({ item }: { item: GrabItem }) {
  return (
    <span className="isl-drop-chip">
      <ItemIcon item={item} />
      <span>{item.name}</span>
      {item.more > 0 && <b>+{item.more}</b>}
    </span>
  );
}

function FolderChoice({ grab, name }: { grab: Grab; name: string }) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="isl-drop-choice" role="group" aria-label={`What to do with ${name}`}>
      <button
        ref={firstRef}
        type="button"
        className="isl-drop-btn primary"
        onClick={() => grab.choose('chat')}
      >
        Start a chat here
      </button>
      <button type="button" className="isl-drop-btn" onClick={() => grab.choose('project')}>
        Add as project
      </button>
      <button type="button" className="isl-drop-btn quiet" onClick={grab.cancel}>
        Cancel
      </button>
    </div>
  );
}

interface DropSceneProps {
  grab: Grab;
  note: string | null;
  replyingTo: string | null;
  sceneRef: RefObject<HTMLDivElement | null>;
}

export function DropScene({ grab, note, replyingTo, sceneRef }: DropSceneProps) {
  const { phase, item } = grab;
  const flying = phase === 'drop' || phase === 'reject';
  const carrying = phase === 'chew' || phase === 'choose' || phase === 'done';
  return (
    <div ref={sceneRef} className="isl-drop" data-phase={phase} hidden={phase === 'idle'}>
      <div className="isl-drop-stage">
        <svg className="isl-arms" viewBox="-40 -34 80 40" aria-hidden="true">
          <Arm side="l" />
          <Arm side="r" />
        </svg>
        <span className="isl-drop-blob">
          <BlobScout
            size={56}
            mood={MOODS[phase]}
            lookAtPointer={phase === 'enter' || phase === 'over' || phase === 'choose'}
          />
        </span>
        {item && flying && (
          <span className="isl-drop-item" data-kind={item.kind}>
            <ItemIcon item={item} />
          </span>
        )}
      </div>
      {item && carrying && <Carried item={item} />}
      <p className="isl-drop-words" role="status">
        <strong>{words(phase, grab, replyingTo)}</strong>
        {phase === 'reject' && note && <span className="isl-drop-note">{note}</span>}
      </p>
      {phase === 'choose' && item && <FolderChoice grab={grab} name={item.name} />}
    </div>
  );
}
