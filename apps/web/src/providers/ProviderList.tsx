import { useState, type ReactNode } from 'react';
import type {
  AdvisorSetup,
  ConnectableId,
  ProviderId,
  ProviderSetup,
} from '@spark-outpost/contracts';
import { InfoTip } from '../ui/InfoTip.tsx';
import { ProviderCard } from './ProviderCard.tsx';

interface ProviderListProps {
  providers: ProviderSetup[];
  advisors: AdvisorSetup[];
  defaultProvider: ProviderId | null;
  onVerifyStart?: () => void;
  onVerifyOutcome?: (outcome: 'success' | 'failure') => void;
  advisorSettings?: ReactNode;
}

export function ProviderList({
  providers,
  advisors,
  defaultProvider,
  onVerifyStart,
  onVerifyOutcome,
  advisorSettings,
}: ProviderListProps) {
  const [openId, setOpenId] = useState<ConnectableId | null>(null);
  const connectedCount = providers.filter((provider) => provider.connection).length;
  const toggle = (id: ConnectableId) => setOpenId((current) => (current === id ? null : id));
  const verifyHandlers = {
    ...(onVerifyStart ? { onVerifyStart } : {}),
    ...(onVerifyOutcome ? { onVerifyOutcome } : {}),
  };
  return (
    <>
      {providers.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          open={openId === provider.id}
          isDefault={connectedCount > 1 && provider.id === defaultProvider}
          canMakeDefault={
            connectedCount > 1 && provider.connection !== null && provider.id !== defaultProvider
          }
          onToggle={() => toggle(provider.id)}
          {...verifyHandlers}
        />
      ))}
      {advisors.length > 0 && (
        <section className="advisors" aria-labelledby="advisors-title">
          <h3 className="advisors-title" id="advisors-title">
            Advisor
          </h3>
          <p className="advisors-note">
            Jev reads each request, asks when it’s unclear and checks finished changes.
            <InfoTip
              topic="Jev"
              text="It never answers chats or approves anything. The rules pick the model."
              doc={{ page: 'jev' }}
            />
          </p>
          {advisors.map((advisor) => (
            <ProviderCard
              key={advisor.id}
              provider={advisor}
              open={openId === advisor.id}
              onToggle={() => toggle(advisor.id)}
              {...verifyHandlers}
            />
          ))}
          {advisorSettings}
        </section>
      )}
    </>
  );
}
