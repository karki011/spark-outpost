import { useState } from 'react';
import type {
  AdvisorSetup,
  ConnectableId,
  ProviderId,
  ProviderSetup,
} from '@spark-outpost/contracts';
import { ProviderCard } from './ProviderCard.tsx';

interface ProviderListProps {
  providers: ProviderSetup[];
  advisors: AdvisorSetup[];
  defaultProvider: ProviderId | null;
  onVerifyStart?: () => void;
  onVerifyOutcome?: (outcome: 'success' | 'failure') => void;
}

export function ProviderList({
  providers,
  advisors,
  defaultProvider,
  onVerifyStart,
  onVerifyOutcome,
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
            Optional routing
          </h3>
          <p className="advisors-note">
            A decision model that can suggest which provider, model, and effort fit a task. It
            doesn't answer chats.
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
        </section>
      )}
    </>
  );
}
