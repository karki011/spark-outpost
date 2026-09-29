import './empty-scene.css';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import { useReducedMotion } from '../ui/motion.ts';
import type { BlobExpression } from './blob-expression.ts';
import { BlobScout, type ScoutMood } from './BlobScout.tsx';
import { ProviderBlob } from './ProviderBlob.tsx';
import {
  arcPoint,
  between,
  curvePoint,
  easeInOut,
  handOf,
  HERO_NAMES,
  heroHue,
  other,
  STAGE,
  type Point,
  type Segment,
  type Side,
} from './rally.ts';

interface EmptySceneProps {
  children: ReactNode;
  size?: 'full' | 'compact';
  fill?: boolean;
  className?: string;
}

interface Moods {
  left: BlobExpression;
  right: BlobExpression;
  scout: ScoutMood;
}

interface Hero {
  name: string;
  hue: number;
}

type SpanRef = RefObject<HTMLSpanElement | null>;

interface RallyRefs {
  ball: SpanRef;
  hero: SpanRef;
  left: SpanRef;
  right: SpanRef;
  scout: SpanRef;
}

const IDLE: Moods = { left: 'idle', right: 'idle', scout: null };
const THROW_SECONDS = 1.3;
const BALL = 5;
const HERO = 20;

function place(element: HTMLElement | null, point: Point, half: number, turn = 0) {
  if (!element) return;
  element.style.transform = `translate(${point.x - half}px, ${point.y - half}px) rotate(${turn}deg)`;
}

function leap(element: HTMLElement | null, lean: number) {
  element?.animate(
    [
      { transform: 'translateY(0) scale(1.1, 0.85)' },
      {
        transform: `translate(${lean}px, -30px) scale(0.92, 1.1) rotate(${lean}deg)`,
        offset: 0.45,
      },
      {
        transform: `translate(${lean}px, -30px) scale(0.95, 1.05) rotate(${lean}deg)`,
        offset: 0.55,
      },
      { transform: 'translateY(0) scale(1.08, 0.9)', offset: 0.9 },
      { transform: 'none' },
    ],
    { duration: 620, easing: 'ease-in-out' },
  );
}

function hop(element: HTMLElement | null) {
  element?.animate(
    [
      { transform: 'translateY(0) scale(1.08, 0.9)' },
      { transform: 'translateY(-8px) scale(0.95, 1.06)', offset: 0.4 },
      { transform: 'none' },
    ],
    { duration: 340, easing: 'ease-out' },
  );
}

function useRally(
  active: boolean,
  refs: RallyRefs,
  setMoods: (moods: Moods) => void,
  setHero: (hero: Hero | null) => void,
) {
  useEffect(() => {
    if (!active) return;
    const random = Math.random;
    const ball = () => refs.ball.current;
    const hero = () => refs.hero.current;
    const hopper = (side: Side) => (side === 'left' ? refs.left.current : refs.right.current);
    const ground = STAGE.ground - BALL;
    let thrower: Side = 'left';
    let queue: Segment[] = [];
    let current: Segment | null = null;
    let started = 0;
    let frame = 0;

    const rescue = (ballX: number, catcher: Side) => {
      const name = HERO_NAMES[Math.floor(random() * HERO_NAMES.length)] ?? 'Captain Merge';
      const fromLeft = random() < 0.5;
      const facing = fromLeft ? 1 : -1;
      const enter = { x: fromLeft ? -50 : STAGE.width + 50, y: between(random, -70, -20) };
      const kick = { x: ballX - facing * 16, y: STAGE.ground - 22 };
      const swoop = { x: (enter.x + kick.x) / 2, y: kick.y + between(random, -10, 30) };
      const loop = { x: between(random, 20, STAGE.width - 20), y: between(random, -140, -60) };
      const leave = { x: fromLeft ? STAGE.width + 60 : -60, y: between(random, -90, -40) };
      const ballStart = { x: ballX, y: ground };
      queue.push(
        { seconds: 0.01, done: () => setHero({ name, hue: heroHue(random) }) },
        {
          seconds: 1.15,
          step: (t) =>
            place(
              hero(),
              curvePoint(enter, swoop, kick, easeInOut(t)),
              HERO,
              facing * (20 - 30 * t),
            ),
          done: () => setMoods({ left: 'happy', right: 'happy', scout: 'happy' }),
        },
        {
          seconds: 1.2,
          step: (t) => {
            place(ball(), arcPoint(ballStart, handOf(catcher), STAGE.arc * 2, t), BALL);
            place(hero(), curvePoint(kick, loop, leave, easeInOut(t)), HERO, facing * 360 * t);
          },
          done: () => {
            hop(hopper(catcher));
            setHero(null);
            thrower = catcher;
          },
        },
        { seconds: 1.4, done: () => setMoods(IDLE) },
      );
    };

    const miss = () => {
      const from = thrower;
      const to = other(from);
      const start = handOf(from);
      const roll = from === 'left' ? 1 : -1;
      const landX = start.x + (handOf(to).x - start.x) * between(random, 0.62, 0.78);
      const bounce = (at: number, height: number, seconds: number, drift: number): Segment => ({
        seconds,
        step: (t) =>
          place(
            ball(),
            arcPoint({ x: at, y: ground }, { x: at + drift, y: ground }, height, t),
            BALL,
          ),
      });
      queue.push(
        {
          seconds: THROW_SECONDS,
          step: (t) =>
            place(ball(), arcPoint(start, { x: landX, y: ground }, STAGE.arc * 0.8, t), BALL),
          done: () =>
            setMoods({
              left: from === 'left' ? 'unsure' : 'sad',
              right: from === 'left' ? 'sad' : 'unsure',
              scout: 'sad',
            }),
        },
        bounce(landX, 18, 0.42, roll * 12),
        bounce(landX + roll * 12, 6, 0.26, roll * 8),
        { seconds: 0.9 },
      );
      rescue(landX + roll * 20, to);
    };

    const rally = () => {
      const throws = Math.round(between(random, 7, 14));
      for (let index = 0; index < throws; index += 1) {
        const from = thrower;
        const to = other(from);
        const jumps = random() < 0.45;
        let jumped = false;
        queue.push({
          seconds: THROW_SECONDS,
          step: (t) => {
            place(ball(), arcPoint(handOf(from), handOf(to), STAGE.arc, t), BALL);
            if (jumps && !jumped && t >= 0.3) {
              jumped = true;
              leap(refs.scout.current, from === 'left' ? 6 : -6);
            }
          },
          done: () => hop(hopper(to)),
        });
        thrower = to;
      }
      miss();
    };

    const tick = (now: number) => {
      if (!current) {
        if (queue.length === 0) rally();
        current = queue.shift() ?? null;
        started = now;
      }
      if (current) {
        const progress = Math.min(1, (now - started) / (current.seconds * 1000));
        current.step?.(progress);
        if (progress >= 1) {
          current.done?.();
          current = null;
        }
      }
      frame = requestAnimationFrame(tick);
    };

    place(ball(), handOf('left'), BALL);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      queue = [];
    };
  }, [active, refs, setMoods, setHero]);
}

function RallyStage() {
  const reduced = useReducedMotion();
  const [moods, setMoods] = useState<Moods>(IDLE);
  const [hero, setHero] = useState<Hero | null>(null);
  const [poked, setPoked] = useState(false);
  const ball = useRef<HTMLSpanElement>(null);
  const heroRef = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);
  const scout = useRef<HTMLSpanElement>(null);
  const [refs] = useState<RallyRefs>(() => ({ ball, hero: heroRef, left, right, scout }));
  const animate = reduced ? 'hover' : 'always';
  useRally(!reduced, refs, setMoods, setHero);

  useEffect(() => {
    if (!poked) return;
    const timeout = setTimeout(() => setPoked(false), 1400);
    return () => clearTimeout(timeout);
  }, [poked]);

  const player = (side: Side) => (
    <span
      className="es-player"
      style={{
        left: side === 'left' ? STAGE.reach - 22 : STAGE.width - STAGE.reach - 22,
        top: STAGE.ground - 44,
      }}
    >
      <span className="es-hop" ref={side === 'left' ? left : right}>
        <ProviderBlob
          providerId={side === 'left' ? 'claude' : 'codex'}
          size={44}
          expression={side === 'left' ? moods.left : moods.right}
          animate={animate}
        />
      </span>
      <i className="es-shadow" />
    </span>
  );

  return (
    <div
      className="es-stage rally"
      aria-hidden="true"
      style={{ width: STAGE.width, height: STAGE.height }}
    >
      <span className="es-ground" style={{ top: STAGE.ground }} />
      {player('left')}
      <span className="es-scout" style={{ left: STAGE.width / 2 - 17, top: STAGE.ground - 34 }}>
        <span className="es-hop" ref={scout}>
          <BlobScout
            size={34}
            mood={poked ? 'happy' : moods.scout}
            lookAtPointer
            onClick={() => setPoked(true)}
          />
        </span>
        <i className="es-shadow" />
      </span>
      {player('right')}
      <span className="es-ball-free" ref={ball}>
        <i className="es-ball" />
      </span>
      <span className={hero ? 'es-hero on' : 'es-hero'} ref={heroRef}>
        {hero && (
          <>
            <i
              className="es-cape"
              style={{ background: `hsl(${(hero.hue + 180) % 360} 70% 52%)` }}
            />
            <Blobatar
              name={`hero:${hero.name}`}
              hue={hero.hue}
              size={HERO * 2}
              animate="always"
              expression={expressions.happy}
              aria-hidden="true"
            />
          </>
        )}
      </span>
    </div>
  );
}

function JuggleStage() {
  const reduced = useReducedMotion();
  return (
    <div className="es-stage juggle" aria-hidden="true">
      <span className="es-ground" />
      <span className="es-player es-left">
        <span className="es-hop">
          <ProviderBlob providerId="claude" size={30} animate={reduced ? 'hover' : 'always'} />
        </span>
        <i className="es-shadow" />
      </span>
      <span className="es-ball-x">
        <span className="es-ball-y">
          <i className="es-ball" />
        </span>
      </span>
    </div>
  );
}

export function EmptyScene({
  children,
  size = 'full',
  fill = false,
  className = '',
}: EmptySceneProps) {
  return (
    <div className={['es', size, fill ? 'fill' : '', className].filter(Boolean).join(' ')}>
      {size === 'full' ? <RallyStage /> : <JuggleStage />}
      <div className="es-text">{children}</div>
    </div>
  );
}
