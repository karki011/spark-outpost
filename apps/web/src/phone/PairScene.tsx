import './pair-scene.css';
import './pair-motion.css';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { pairingLink, PAIRING_TTL_MS, type PendingPairing } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import {
  countdownText,
  motionMood,
  stageLine,
  stageMotion,
  type Activation,
  type PairStage,
} from './pair-flow.ts';
import { QrCode } from './QrCode.tsx';

interface PairSceneProps {
  stage: PairStage;
  activation: Activation;
  hidden: boolean;
  hostname: string | null;
  busy: boolean;
  error: string | null;
  onStart: () => void;
  onAnswer: (request: PendingPairing, answer: 'confirm' | 'deny') => void;
}

const RING_RADIUS = 15;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function PhoneGlyph() {
  return (
    <svg
      className="ph-scene-phone"
      viewBox="0 0 24 24"
      width="34"
      height="34"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}

function CountdownRing({ remainingMs, expiring }: { remainingMs: number; expiring: boolean }) {
  const left = Math.max(0, Math.min(1, remainingMs / PAIRING_TTL_MS));
  return (
    <span className={expiring ? 'ph-ring expiring' : 'ph-ring'}>
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle className="ph-ring-track" cx="18" cy="18" r={RING_RADIUS} />
        <circle
          className="ph-ring-left"
          cx="18"
          cy="18"
          r={RING_RADIUS}
          strokeDasharray={RING_LENGTH}
          strokeDashoffset={RING_LENGTH * (1 - left)}
        />
      </svg>
      <span className="ph-ring-text">
        <span className="sr-only">Time left: </span>
        {countdownText(remainingMs)}
      </span>
    </span>
  );
}

function usePrimaryFocus(kind: PairStage['kind'], primary: RefObject<HTMLButtonElement | null>) {
  const shown = useRef(kind);
  useEffect(() => {
    if (shown.current === kind) return;
    shown.current = kind;
    const scene = primary.current?.closest('.ph-scene');
    const focused = document.activeElement;
    const elsewhere = focused !== null && focused !== document.body && !scene?.contains(focused);
    if (!elsewhere) primary.current?.focus({ preventScroll: true });
  }, [kind, primary]);
}

function useOnScreen(target: RefObject<HTMLElement | null>): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = target.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      setOnScreen(entries[entries.length - 1]?.isIntersecting ?? true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [target]);
  return onScreen;
}

function sceneClass(stage: PairStage): string {
  const expiring = stage.kind === 'code' && stage.expiring;
  return ['ph-scene', stage.kind, expiring ? 'expiring' : ''].filter(Boolean).join(' ');
}

export function PairScene({
  stage,
  activation,
  hidden,
  hostname,
  busy,
  error,
  onStart,
  onAnswer,
}: PairSceneProps) {
  const scene = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  usePrimaryFocus(stage.kind, primary);
  const onScreen = useOnScreen(scene);
  const motion = stageMotion(stage, activation);
  const line = stageLine(stage, activation);
  const meetsPhone = stage.kind === 'found' || stage.kind === 'paired';

  const startButton = (label: string): ReactNode => (
    <button ref={primary} type="button" className="btn primary" disabled={busy} onClick={onStart}>
      {label}
    </button>
  );

  return (
    <div
      ref={scene}
      className={sceneClass(stage)}
      data-stage={stage.kind}
      data-blob={motion}
      data-paused={hidden || !onScreen || undefined}
    >
      <p className="sr-only" role="status" aria-live="polite">
        {line}
      </p>
      <div className="ph-scene-stage" aria-hidden="true">
        <span className="ph-scene-blob">
          <BlobScout size={72} mood={motionMood(motion)} />
          <i className="ph-scene-shadow" />
        </span>
        {meetsPhone && <PhoneGlyph />}
      </div>
      <p className="ph-scene-line" aria-hidden="true">
        {line}
      </p>

      {stage.kind === 'ready' && startButton('Pair a phone')}

      {stage.kind === 'code' && hostname && (
        <div className="ph-code">
          <QrCode
            text={pairingLink(hostname, stage.pairing.code)}
            label="QR code that opens the pairing page on your phone"
          />
          <div className="ph-code-side">
            <span className="ph-code-label" id="ph-code-label">
              Pairing code
            </span>
            <output className="ph-code-text" aria-labelledby="ph-code-label">
              {stage.pairing.code}
            </output>
            <CountdownRing remainingMs={stage.remainingMs} expiring={stage.expiring} />
            <button
              ref={primary}
              type="button"
              className={stage.expiring ? 'btn primary sm' : 'btn line sm'}
              disabled={busy}
              onClick={onStart}
            >
              Get a new code
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'found' && (
        <div className="ph-found">
          <span className="ph-found-name">{stage.request.deviceName}</span>
          <output className="ph-match" aria-label={`Matching code ${stage.request.matchCode}`}>
            {stage.request.matchCode}
          </output>
          <div className="ph-found-actions">
            <button
              ref={primary}
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => onAnswer(stage.request, 'confirm')}
            >
              Confirm
            </button>
            <button
              type="button"
              className="btn line"
              disabled={busy}
              onClick={() => onAnswer(stage.request, 'deny')}
            >
              Deny
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'ended' && startButton('Try again')}

      {error && (
        <p className="ph-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
