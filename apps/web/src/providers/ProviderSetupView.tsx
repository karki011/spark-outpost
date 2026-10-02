import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { useQueries, useQuery } from '@tanstack/react-query';
import type {
  AdvisorSetup,
  ConnectableId,
  ProviderId,
  ProviderSetup,
} from '@spark-outpost/contracts';
import { capabilitiesQuery } from '../api/client.ts';
import { homeApi, homeKeys } from '../home/home-api.ts';
import { modelLabel } from '../home/provider-status.ts';
import { useReducedMotion } from '../ui/motion.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { slide } from '../ui/transitions.tsx';
import { ProviderConfigure } from './ProviderConfigure.tsx';
import { ProviderTiles, type TileItem } from './ProviderTiles.tsx';
import { tileStatus, type VerifyFailure } from './tile-status.ts';
import '../ui/controls.css';
import './providers.css';
import './provider-tiles.css';

const OFFSET = 32;

const views: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: OFFSET * direction, scale: 0.98 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit: (direction: number) => ({ opacity: 0, x: -OFFSET * direction, scale: 0.98 }),
};

interface ProviderSetupViewProps {
  providers: ProviderSetup[];
  advisors: AdvisorSetup[];
  defaultProvider: ProviderId | null;
  openId: ConnectableId | null;
  onOpenChange: (id: ConnectableId | null) => void;
  onVerifyStart?: () => void;
  onVerifyOutcome?: (outcome: 'success' | 'failure') => void;
  advisorSettings?: ReactNode;
  density: 'compact' | 'roomy';
}

function useModelLabels(providers: ProviderSetup[]) {
  const connected = providers.filter((provider) => provider.connection);
  const capabilities = useQueries({
    queries: connected.map((provider) => ({ ...capabilitiesQuery(provider.id), retry: false })),
  });
  return new Map(
    connected.map((provider, index) => {
      const caps = capabilities[index]?.data;
      const label = modelLabel(provider.connection, caps?.models ?? [], caps?.defaultModel ?? null);
      return [provider.id, label];
    }),
  );
}

export function ProviderSetupView({
  providers,
  advisors,
  defaultProvider,
  openId,
  onOpenChange,
  onVerifyStart,
  onVerifyOutcome,
  advisorSettings,
  density,
}: ProviderSetupViewProps) {
  const [failures, setFailures] = useState<Partial<Record<ConnectableId, VerifyFailure>>>({});
  const [lastOpened, setLastOpened] = useState<ConnectableId | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const reduced = useReducedMotion();
  const health = useQuery({ queryKey: homeKeys.health, queryFn: homeApi.health });
  const models = useModelLabels(providers);
  const connectedCount = providers.filter((provider) => provider.connection).length;

  const itemFor = (setup: ProviderSetup | AdvisorSetup): TileItem => {
    const issue = health.data?.issues.find((entry) => entry.provider === setup.id) ?? null;
    const isProvider = !('role' in setup);
    return {
      setup,
      status: tileStatus(setup, issue, failures[setup.id] ?? null, relativeTime),
      model: isProvider
        ? (models.get(setup.id) ?? null)
        : setup.connection
          ? (setup.connection.model ?? null)
          : null,
      isDefault: isProvider && connectedCount > 1 && setup.id === defaultProvider,
    };
  };

  const providerItems = providers.map(itemFor);
  const advisorItems = advisors.map(itemFor);
  const open = [...providerItems, ...advisorItems].find((item) => item.setup.id === openId);

  const show = (id: ConnectableId | null) => {
    setDirection(id ? 1 : -1);
    onOpenChange(id);
  };

  const recordFailure = (id: ConnectableId, failure: VerifyFailure | null) =>
    setFailures((current) => {
      const next = { ...current };
      if (failure) next[id] = failure;
      else delete next[id];
      return next;
    });

  return (
    <div className="psetup">
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={open ? open.setup.id : 'tiles'}
          className="psetup-view"
          custom={direction}
          variants={views}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduced ? { duration: 0 } : slide}
        >
          {open ? (
            <ProviderConfigure
              density={density}
              setup={open.setup}
              status={open.status}
              isDefault={open.isDefault}
              canMakeDefault={
                !('role' in open.setup) &&
                connectedCount > 1 &&
                open.setup.connection !== null &&
                open.setup.id !== defaultProvider
              }
              advisorSettings={'role' in open.setup ? advisorSettings : undefined}
              onVerifyStart={onVerifyStart}
              onVerifyOutcome={onVerifyOutcome}
              onFailure={(failure) => recordFailure(open.setup.id, failure)}
              onClose={() => {
                setLastOpened(open.setup.id);
                show(null);
              }}
            />
          ) : (
            <ProviderTiles
              providers={providerItems}
              advisors={advisorItems}
              focusId={lastOpened}
              onOpen={show}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
