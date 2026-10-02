import { useEffect, useId, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { AdvisorSetup, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { burstAt } from '../ui/sparks.ts';
import { ConnectSection } from './ConnectSection.tsx';
import { DangerZone } from './DangerZone.tsx';
import { DefaultsSection } from './DefaultsSection.tsx';
import { StatusChip } from './StatusChip.tsx';
import { TestSection } from './TestSection.tsx';
import { useTestMessage, type TestPhase } from './test-message.ts';
import type { TileStatus } from './tile-status.ts';
import {
  useProviderConnect,
  type ConnectCallbacks,
  type ProviderMood,
} from './use-provider-connect.ts';
import './provider-configure.css';

const TEST_MOOD: Partial<Record<TestPhase, ProviderMood>> = { answered: 'happy', failed: 'sad' };

function ConfigSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: 'danger';
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={tone ? `pconf-sec ${tone}` : 'pconf-sec'} aria-labelledby={id}>
      <h4 className="pconf-sec-title" id={id}>
        {title}
      </h4>
      {children}
    </section>
  );
}

interface ProviderConfigureProps extends ConnectCallbacks {
  setup: ProviderSetup | AdvisorSetup;
  status: TileStatus;
  isDefault: boolean;
  canMakeDefault: boolean;
  advisorSettings?: ReactNode;
  onClose: () => void;
}

export function ProviderConfigure({
  setup,
  status,
  isDefault,
  canMakeDefault,
  advisorSettings,
  onClose,
  ...callbacks
}: ProviderConfigureProps) {
  const connect = useProviderConnect(setup, callbacks);
  const test = useTestMessage();
  const backRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (connect.celebrate) requestAnimationFrame(() => burstAt(chipRef.current, 18, 60));
  }, [connect.celebrate]);

  const classes = [
    'pconf',
    setup.connection ? 'connected' : '',
    connect.celebrate ? 'celebrate' : '',
    connect.shake ? 'nope' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      data-prov={setup.id}
      role="region"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="pconf-head">
        <button
          ref={backRef}
          type="button"
          className="pconf-back"
          aria-label="Back to AI providers"
          onClick={onClose}
        >
          <BackIcon />
        </button>
        <motion.span
          className={test.phase === 'idle' ? 'plogo' : `plogo test-${test.phase}`}
          layoutId={`pblob-${setup.id}`}
        >
          <ProviderBlob
            providerId={setup.id}
            size={48}
            expression={TEST_MOOD[test.phase] ?? connect.mood}
            animate="always"
          />
        </motion.span>
        <span className="pconf-name">
          <h3 id={titleId}>{setup.name}</h3>
          <small>by {setup.maker}</small>
        </span>
        <StatusChip status={status} chipRef={chipRef} />
      </header>
      <ConfigSection title="How to connect">
        <ConnectSection setup={setup} connect={connect} />
      </ConfigSection>
      <ConfigSection title="Test">
        <TestSection setup={setup} connect={connect} test={test} />
      </ConfigSection>
      <ConfigSection title={'role' in setup ? 'Settings' : 'Defaults for new chats'}>
        <DefaultsSection
          setup={setup}
          isDefault={isDefault}
          canMakeDefault={canMakeDefault}
          advisorSettings={advisorSettings}
        />
      </ConfigSection>
      {setup.connection && (
        <ConfigSection title="Danger zone" tone="danger">
          <DangerZone
            providerId={setup.id}
            name={setup.name}
            method={setup.connection.method}
            onRefused={connect.nudge}
          />
        </ConfigSection>
      )}
      {setup.connection && (
        <footer className="pconf-foot">
          <button type="button" className="btn primary sm" onClick={onClose}>
            Done
          </button>
        </footer>
      )}
    </div>
  );
}
