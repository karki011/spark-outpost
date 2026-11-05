import { useEffect, useId, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { AdvisorSetup, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { burstAt } from '../ui/sparks.ts';
import { ConfigSection } from './ConfigSection.tsx';
import { ConnectSection } from './ConnectSection.tsx';
import { DangerZone } from './DangerZone.tsx';
import { DefaultsSection } from './DefaultsSection.tsx';
import { screenState, useSectionState, type SectionId } from './section-state.ts';
import { connectSummary, DefaultsSummary, testSummary } from './SectionSummaries.tsx';
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
import './provider-compact.css';

const TEST_MOOD: Partial<Record<TestPhase, ProviderMood>> = { answered: 'happy', failed: 'sad' };

interface ProviderConfigureProps extends ConnectCallbacks {
  setup: ProviderSetup | AdvisorSetup;
  status: TileStatus;
  isDefault: boolean;
  canMakeDefault: boolean;
  density: 'compact' | 'roomy';
  onClose: () => void;
}

export function ProviderConfigure({
  setup,
  status,
  isDefault,
  canMakeDefault,
  density,
  onClose,
  ...callbacks
}: ProviderConfigureProps) {
  const connect = useProviderConnect(setup, callbacks);
  const test = useTestMessage();
  const backRef = useRef<HTMLButtonElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const titleId = useId();
  const compact = density === 'compact';
  const sections = useSectionState(
    setup.id,
    screenState(setup.connection !== null, status),
    status,
  );
  const disclosure = (section: SectionId, summary: ReactNode) =>
    compact
      ? {
          open: sections.isOpen(section),
          summary,
          onToggle: () => sections.setOpen(section, !sections.isOpen(section)),
        }
      : undefined;
  const connection = setup.connection;
  const defaultsSummary =
    'role' in setup ? (
      (setup.connection?.model ?? 'No model yet')
    ) : setup.connection ? (
      <DefaultsSummary provider={setup} connection={setup.connection} />
    ) : (
      'Connect first'
    );

  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (connect.celebrate) requestAnimationFrame(() => burstAt(chipRef.current, 18, 60));
  }, [connect.celebrate]);

  const classes = [
    'pconf',
    density,
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
            size={compact ? 34 : 48}
            expression={TEST_MOOD[test.phase] ?? connect.mood}
            animate="always"
          />
        </motion.span>
        <span className="pconf-name">
          <h3 id={titleId}>{setup.name}</h3>
          <small>by {setup.maker}</small>
        </span>
        <StatusChip status={status} chipRef={chipRef} />
        {compact && connection && (
          <button type="button" className="btn primary sm pconf-done" onClick={onClose}>
            Done
          </button>
        )}
      </header>
      <ConfigSection
        title="How to connect"
        disclosure={disclosure('connect', connectSummary(setup, status))}
      >
        <ConnectSection setup={setup} connect={connect} compact={compact} />
      </ConfigSection>
      <ConfigSection
        title="Test"
        disclosure={disclosure('test', testSummary(setup, connect, test))}
      >
        <TestSection setup={setup} connect={connect} test={test} />
      </ConfigSection>
      <ConfigSection
        title={'role' in setup ? 'Settings' : 'Defaults for new chats'}
        disclosure={disclosure('defaults', defaultsSummary)}
      >
        <DefaultsSection setup={setup} isDefault={isDefault} canMakeDefault={canMakeDefault} />
      </ConfigSection>
      {connection && (
        <ConfigSection
          title="Danger zone"
          tone="danger"
          disclosure={disclosure(
            'danger',
            connection.method === 'api_key' ? 'Remove the key' : 'Disconnect',
          )}
        >
          <DangerZone
            providerId={setup.id}
            name={setup.name}
            method={connection.method}
            onRefused={connect.nudge}
          />
        </ConfigSection>
      )}
      {connection && !compact && (
        <footer className="pconf-foot">
          <button type="button" className="btn primary sm" onClick={onClose}>
            Done
          </button>
        </footer>
      )}
    </div>
  );
}
