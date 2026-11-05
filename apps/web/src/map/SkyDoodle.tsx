import { useEffect, useState, type CSSProperties } from 'react';
import type { ConnectableId } from '@spark-outpost/contracts';
import { BlobScout, type ScoutMood } from '../brand/BlobScout.tsx';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { useReducedMotion } from '../ui/motion.ts';

interface Star {
  id: ConnectableId;
  x: number;
  y: number;
}

const WIDTH = 320;
const HEIGHT = 150;
const STAR = 34;
const SCOUT = 26;
const STEP_MS = 2400;
const STARS: Star[] = [
  { id: 'claude', x: 46, y: 100 },
  { id: 'codex', x: 126, y: 46 },
  { id: 'jev', x: 208, y: 96 },
  { id: 'zai', x: 278, y: 40 },
];
const EDGES = STARS.slice(1).map((star, index) => ({ from: STARS[index]!, to: star }));
const ALL_DRAWN = EDGES.length;
const STEPS = EDGES.length + 2;
const DUST = [
  [14, 22, 0],
  [70, 18, 1.1],
  [176, 20, 0.4],
  [240, 132, 1.7],
  [306, 108, 0.8],
  [100, 128, 2.2],
  [160, 74, 1.4],
  [22, 60, 2.6],
] as const;

type EdgeState = 'hidden' | 'on' | 'fade';

function edgeState(index: number, step: number): EdgeState {
  if (step > ALL_DRAWN) return 'fade';
  return index <= step ? 'on' : 'hidden';
}

function scoutSpot(step: number): Star {
  if (step > ALL_DRAWN) return STARS[0]!;
  return STARS[Math.min(step + 1, STARS.length - 1)]!;
}

function scoutMood(step: number): ScoutMood {
  if (step === ALL_DRAWN) return 'happy';
  if (step < ALL_DRAWN) return 'working';
  return null;
}

function useStep(moving: boolean): number {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => setStep((current) => (current + 1) % STEPS), STEP_MS);
    return () => clearInterval(timer);
  }, [moving]);
  return moving ? step : ALL_DRAWN;
}

export function SkyDoodle() {
  const still = useReducedMotion();
  const step = useStep(!still);
  const spot = scoutSpot(step);
  return (
    <div className="mh-sky" aria-hidden="true" style={{ width: WIDTH, height: HEIGHT }}>
      {DUST.map(([x, y, delay]) => (
        <i
          key={`${x}-${y}`}
          className="mh-dust"
          style={{ left: x, top: y, animationDelay: `${delay}s` }}
        />
      ))}
      <svg className="mh-lines" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        {EDGES.map((edge, index) => (
          <line
            key={edge.to.id}
            className={`mh-edge ${edgeState(index, step)}`}
            x1={edge.from.x}
            y1={edge.from.y}
            x2={edge.to.x}
            y2={edge.to.y}
            pathLength={1}
          />
        ))}
      </svg>
      {STARS.map((star, index) => (
        <span
          key={star.id}
          className="mh-star"
          style={
            {
              left: star.x - STAR / 2,
              top: star.y - STAR / 2,
              '--bob-delay': `${index * -0.7}s`,
            } as CSSProperties
          }
        >
          <ProviderBlob
            providerId={star.id}
            size={STAR}
            expression={step === ALL_DRAWN ? 'happy' : 'idle'}
            animate={still ? 'hover' : 'always'}
          />
        </span>
      ))}
      <span
        className="mh-scout"
        style={{ transform: `translate(${spot.x - SCOUT / 2}px, ${spot.y - SCOUT / 2 - 30}px)` }}
      >
        <BlobScout size={SCOUT} mood={scoutMood(step)} />
      </span>
    </div>
  );
}
