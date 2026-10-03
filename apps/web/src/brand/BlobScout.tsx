import { useEffect, useId, useRef, useState } from 'react';
import './scout.css';
import { prefersReducedMotion } from '../ui/motion.ts';
import { scoutFaceCenter, scoutLookTransform, type LookTarget } from './scout-look.ts';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout-shape.ts';

export type ScoutMood = 'working' | 'alert' | 'happy' | 'sad' | 'sleep' | null;

interface BlobScoutProps {
  size?: number;
  mood?: ScoutMood;
  lookAtPointer?: boolean;
  className?: string;
  fill?: number | null;
  onClick?: () => void;
}

const FILL_BOTTOM = 59;
const WAVE = `M-64 0${' q4 -2.4 8 0 t8 0'.repeat(12)} V80 H-64 Z`;

function fillOffset(fill: number): number {
  const clamped = Math.max(0, Math.min(100, fill));
  return FILL_BOTTOM - (FILL_BOTTOM * clamped) / 100;
}

function ScoutShape() {
  return (
    <>
      <path
        className="sc-ant"
        d={SCOUT_ANTENNA}
        fill="none"
        stroke="var(--sc-a)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path className="sc-spark" d={SCOUT_SPARK} fill="var(--sc-b)" />
      <path d={SCOUT_BODY} fill="var(--sc-a)" />
    </>
  );
}

function ScoutFill({ fill }: { fill: number }) {
  const maskId = `sc-fill-${useId().replace(/[^\w-]/g, '')}`;
  return (
    <>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80">
        <g className="sc-fill-level" style={{ transform: `translateY(${fillOffset(fill)}px)` }}>
          <path className="sc-wave" d={WAVE} fill="#fff" />
        </g>
      </mask>
      <g className="sc-filled" mask={`url(#${maskId})`}>
        <ScoutShape />
      </g>
    </>
  );
}

const FACE_STALE_MS = 200;

function followPointer(root: SVGSVGElement, look: SVGGElement): () => void {
  let raf = 0;
  let pointer: LookTarget | null = null;
  let face: LookTarget | null = null;
  let measuredAt = -Infinity;
  let written = '';
  const turn = (time: number) => {
    raf = 0;
    if (!pointer) return;
    if (time - measuredAt > FACE_STALE_MS) {
      face = scoutFaceCenter(root.getBoundingClientRect());
      measuredAt = time;
    }
    if (!face) return;
    const next = scoutLookTransform(face, pointer);
    if (next === written) return;
    written = next;
    look.style.transform = next;
  };
  const onMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    raf ||= requestAnimationFrame(turn);
  };
  addEventListener('pointermove', onMove, { passive: true });
  return () => {
    removeEventListener('pointermove', onMove);
    if (raf) cancelAnimationFrame(raf);
  };
}

export function BlobScout({
  size = 28,
  mood = null,
  lookAtPointer = false,
  className = '',
  fill = null,
  onClick,
}: BlobScoutProps) {
  const rootRef = useRef<SVGSVGElement>(null);
  const lookRef = useRef<SVGGElement>(null);
  const [poking, setPoking] = useState(false);

  useEffect(() => {
    if (!lookAtPointer || prefersReducedMotion()) return;
    const root = rootRef.current;
    const look = lookRef.current;
    if (!root || !look) return;
    return followPointer(root, look);
  }, [lookAtPointer]);

  useEffect(() => {
    if (!poking) return;
    const timeout = setTimeout(() => setPoking(false), 500);
    return () => clearTimeout(timeout);
  }, [poking]);

  const handleClick = () => {
    if (!prefersReducedMotion()) setPoking(true);
    onClick?.();
  };

  const classes = [
    'scout',
    mood ?? '',
    poking ? 'poke' : '',
    fill === null ? '' : 'filling',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <svg
      ref={rootRef}
      className={classes}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      onClick={handleClick}
    >
      <g className="sc-hop">
        <g className="sc-body">
          <g className="sc-base">
            <ScoutShape />
          </g>
          {fill !== null && <ScoutFill fill={fill} />}
          <g className="sc-cheeks">
            <circle cx="18.5" cy="46.5" r="2.7" />
            <circle cx="45.5" cy="46.5" r="2.7" />
          </g>
          <g className="sc-look" ref={lookRef}>
            <rect className="sc-eye" x="22.5" y="32" width="5.6" height="11" rx="2.8" />
            <rect className="sc-eye" x="35.9" y="32" width="5.6" height="11" rx="2.8" />
            <path
              className="sc-happy"
              d="M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5"
            />
            <path className="sc-sleep" d="M22.8 39.5H27.8M36.2 39.5H41.2" />
          </g>
        </g>
      </g>
    </svg>
  );
}
