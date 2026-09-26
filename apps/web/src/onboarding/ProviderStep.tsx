import type { AdvisorSetup, ProviderId, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderList } from '../providers/ProviderList.tsx';

interface ProviderStepProps {
  providers: ProviderSetup[];
  advisors: AdvisorSetup[];
  defaultProvider: ProviderId | null;
  onVerifyStart: () => void;
  onVerifyOutcome: (outcome: 'success' | 'failure') => void;
}

export function ProviderStep({
  providers,
  advisors,
  defaultProvider,
  onVerifyStart,
  onVerifyOutcome,
}: ProviderStepProps) {
  return (
    <>
      <h2 id="onbTitle">Connect your AI providers</h2>
      <p className="lede">
        Connect at least one provider and pick its defaults. If you connect more than one, the
        default starts new chats. You can add others anytime.
      </p>
      <ProviderList
        providers={providers}
        advisors={advisors}
        defaultProvider={defaultProvider}
        onVerifyStart={onVerifyStart}
        onVerifyOutcome={onVerifyOutcome}
      />
    </>
  );
}
