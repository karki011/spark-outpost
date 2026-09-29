import { useEffect, useRef, useState } from 'react';
import './scout.css';
import { prefersReducedMotion } from '../ui/motion.ts';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout-shape.ts';

export type ScoutMood = 'working' | 'alert' | 'happy' | 'sad' | 'sleep' | null;

interface BlobScoutProps {
  size?: number;
  mood?: ScoutMood;
  lookAtPointer?: boolean;
  className?: string;
  onClick?: () => void;
}

function lookAt(look: SVGGElement, root: SVGSVGElement, x: number, y: number): void {
  const rect = root.getBoundingClientRect();
  if (!rect.width) return;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height * 0.6;
  const dx = x - centerX;
  const dy = y - centerY;
  const distance = Math.hypot(dx, dy) || 1;
  const magnitude = 2.8 * Math.min(1, distance / 220);
  const x2 = ((dx / distance) * magnitude).toFixed(2);
  const y2 = ((dy / distance) * magnitude * 0.8).toFixed(2);
  look.style.transform = `translate(${x2}px,${y2}px)`;
}

export function BlobScout({
  size = 28,
  mood = null,
  lookAtPointer = false,
  className = '',
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
    let raf = 0;
    let last: [number, number] | null = null;
    const onMove = (event: PointerEvent) => {
      last = [event.clientX, event.clientY];
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (last) lookAt(look, root, last[0], last[1]);
      });
    };
    addEventListener('pointermove', onMove, { passive: true });
    return () => {
      removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
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

  const classes = ['scout', mood ?? '', poking ? 'poke' : '', className].filter(Boolean).join(' ');

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
