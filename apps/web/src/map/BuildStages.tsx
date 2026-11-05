import './build-stages.css';
import { useEffect, useState } from 'react';
import { Blobatar } from 'blobatar/react';
import * as expressions from 'blobatar/expression';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { useReducedMotion } from '../ui/motion.ts';
import {
  estimateLeft,
  stageCount,
  stageShare,
  type BuildStages,
  type EtaSample,
  type Stage,
} from './build-stages.ts';

const STAGE_SEED = {
  read: { name: 'map-reader', hue: 196 },
  trace: { name: 'map-tracer', hue: 268 },
  link: { name: 'map-linker', hue: 150 },
} as const;
const BLOB = 36;
const ETA_TICK_MS = 5_000;

const EXPRESSION: Record<Stage['state'], BlobExpression> = {
  done: 'happy',
  active: 'thinking',
  next: 'idle',
  asleep: 'sleepy',
};

const STATE_TEXT: Record<Stage['state'], string> = {
  done: 'done',
  active: 'working',
  next: 'up next',
  asleep: 'asleep',
};

function useEta(key: string, done: number, total: number): string | null {
  const [now, setNow] = useState(Date.now);
  const [sample, setSample] = useState<EtaSample>({ key, at: now, done });
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ETA_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  if (sample.key !== key) {
    setSample({ key, at: now, done });
    return null;
  }
  return estimateLeft(sample, now, done, total);
}

function StageBlob({ stage, still }: { stage: Stage; still: boolean }) {
  const expression = EXPRESSION[stage.state];
  const animate = stage.state === 'active' && !still ? 'always' : 'hover';
  if (stage.id === 'label') {
    return <ProviderBlob providerId="jev" size={BLOB} expression={expression} animate={animate} />;
  }
  const seed = STAGE_SEED[stage.id];
  return (
    <Blobatar
      name={seed.name}
      hue={seed.hue}
      size={BLOB}
      animate={animate}
      expression={expressions[expression]}
      aria-hidden="true"
    />
  );
}

export function StageRow({ stages }: { stages: readonly Stage[] }) {
  const still = useReducedMotion();
  return (
    <ol className="bst-row" aria-label="Build stages">
      {stages.map((stage) => (
        <li key={stage.id} className={`bst ${stage.id} ${stage.state}`}>
          <span className="bst-blob" aria-hidden="true">
            <StageBlob stage={stage} still={still} />
            {stage.state === 'done' && (
              <i className="bst-check">
                <CheckIcon />
              </i>
            )}
          </span>
          <span className="bst-name">
            {stage.name}
            <span className="sr-only">, {STATE_TEXT[stage.state]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function StageBar({ stages }: { stages: readonly Stage[] }) {
  return (
    <div className="bst-bar" aria-hidden="true">
      {stages.map((stage) => {
        const fill = stage.state === 'done' ? 1 : stage.state === 'active' ? stageShare(stage) : 0;
        return (
          <span key={stage.id} className={`bst-seg ${stage.state}`}>
            {fill === null ? <i className="bst-busy" /> : <i style={{ width: `${fill * 100}%` }} />}
          </span>
        );
      })}
    </div>
  );
}

function headline(build: BuildStages): string {
  if (build.paused) return 'Paused while agents run. I’ll pick up when they finish.';
  if (build.waiting) return 'Your project is in line for its first map.';
  const active = build.active;
  if (!active) return 'Finishing up.';
  const count = stageCount(active);
  return count ? `${active.doing} · ${count}` : `${active.doing}…`;
}

export function BuildCard({ build }: { build: BuildStages }) {
  const active = build.active;
  const progressKey = `${active?.id ?? 'none'}:${build.paused}`;
  const eta = useEta(progressKey, active?.progress?.done ?? 0, active?.progress?.total ?? 0);
  return (
    <div className="map-say map-glass map-build" data-map-overlay>
      <StageRow stages={build.stages} />
      <div className="bst-text">
        <p>{headline(build)}</p>
        <small>
          {build.paused || build.waiting
            ? 'Maps build in the background and never slow down your chats.'
            : 'Each area lights up on the map when it’s ready.'}
          {eta && !build.paused ? ` · ${eta}` : ''}
        </small>
      </div>
      <StageBar stages={build.stages} />
    </div>
  );
}
