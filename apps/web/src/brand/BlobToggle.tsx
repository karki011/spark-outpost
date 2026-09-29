import './blob-toggle.css';
import { useState } from 'react';
import { useReducedMotion } from '../ui/motion.ts';
import { SCOUT_ANTENNA, SCOUT_BODY, SCOUT_SPARK } from './scout-shape.ts';

export type BlobKind = 'spark' | 'coin' | 'sun' | 'plain';

interface BlobToggleProps {
  label: string;
  kind?: BlobKind;
  size?: 'md' | 'sm';
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
  describedBy?: string;
  disabled?: boolean;
}

const HAPPY_EYES = 'M22.4 40.5Q25.3 34.5 28.2 40.5M35.8 40.5Q38.7 34.5 41.6 40.5';
const SLEEPY_EYES = 'M22.4 38.5Q25.3 42 28.2 38.5M35.8 38.5Q38.7 42 41.6 38.5';
const SUN_RAYS =
  'M50 0.5V2.5M50 17.5V19.5M40.5 10H42.5M57.5 10H59.5M43.3 3.3L44.7 4.7M55.3 15.3L56.7 16.7M43.3 16.7L44.7 15.3M55.3 4.7L56.7 3.3';

function SparkAntenna() {
  return (
    <g className="btog-antenna">
      <path className="btog-ant" d={SCOUT_ANTENNA} />
      <path className="btog-extra btog-spark" d={SCOUT_SPARK} />
    </g>
  );
}

function RisingSun() {
  return (
    <g className="btog-sun">
      <path className="btog-rays" d={SUN_RAYS} />
      <circle className="btog-extra" cx="50" cy="10" r="5.5" />
    </g>
  );
}

function HeldCoin() {
  return (
    <g className="btog-coin">
      <circle className="btog-extra" cx="50" cy="46" r="8.5" />
      <circle className="btog-coin-rim" cx="50" cy="46" r="5.4" />
      <path className="btog-coin-rim" d="M50 43.2V48.8" />
      <circle className="btog-paw" cx="43.5" cy="50.5" r="4" />
    </g>
  );
}

function AwakeFace({ kind }: { kind: BlobKind }) {
  return (
    <g className="btog-awake">
      {kind === 'coin' ? (
        <>
          <rect className="btog-eye" x="24.6" y="33.5" width="5.4" height="9" rx="2.7" />
          <rect className="btog-eye" x="37.6" y="33.5" width="5.4" height="9" rx="2.7" />
          <path className="btog-line" d="M28.5 48.5Q31.5 51.5 34.5 48.5" />
        </>
      ) : (
        <path className="btog-line" d={HAPPY_EYES} />
      )}
      {kind === 'sun' && (
        <path className="btog-mouth" d="M27.5 46.5H36.5Q36.5 52 32 52Q27.5 52 27.5 46.5Z" />
      )}
      <circle className="btog-cheek" cx="18.5" cy="46.5" r="2.7" />
      <circle className="btog-cheek" cx="45.5" cy="46.5" r="2.7" />
    </g>
  );
}

function BlobPicture({ kind }: { kind: BlobKind }) {
  return (
    <svg className="btog-blob" viewBox="0 0 64 64" aria-hidden="true">
      <g className="btog-hop">
        {kind === 'sun' && <RisingSun />}
        <g className="btog-body">
          {kind === 'spark' && <SparkAntenna />}
          <path className="btog-skin" d={SCOUT_BODY} />
          <AwakeFace kind={kind} />
          <path className="btog-line btog-asleep" d={SLEEPY_EYES} />
          <ellipse className="btog-yawn" cx="32" cy="48.5" rx="3.2" ry="4" />
          {kind === 'coin' && <HeldCoin />}
        </g>
      </g>
      <path className="btog-z" d="M54 2.5H60L54 9H60" />
    </svg>
  );
}

function useLive(checked: boolean): boolean {
  const reducedMotion = useReducedMotion();
  const [first] = useState(checked);
  const [changed, setChanged] = useState(false);
  if (!changed && checked !== first) setChanged(true);
  return changed && !reducedMotion;
}

function classesFor(size: 'md' | 'sm', live: boolean, extra = ''): string {
  return ['btog', size === 'sm' ? 'sm' : '', live ? 'btog-live' : '', extra]
    .filter(Boolean)
    .join(' ');
}

export function BlobToggle({
  label,
  kind = 'plain',
  size = 'md',
  checked,
  onChange,
  id,
  describedBy,
  disabled = false,
}: BlobToggleProps) {
  const live = useLive(checked);
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className={classesFor(size, live)}
      data-on={checked}
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <BlobPicture kind={kind} />
    </button>
  );
}

export function BlobSwitchFace({
  checked,
  kind = 'plain',
  size = 'sm',
}: {
  checked: boolean;
  kind?: BlobKind;
  size?: 'md' | 'sm';
}) {
  const live = useLive(checked);
  return (
    <span className={classesFor(size, live, 'btog-face')} data-on={checked} aria-hidden="true">
      <BlobPicture kind={kind} />
    </span>
  );
}
