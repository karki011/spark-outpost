import { useState } from 'react';
import type {
  AdvisorSetup,
  ConnectableId,
  ProviderId,
  ProviderSetup,
} from '@spark-outpost/contracts';
import { ProviderSetupView } from '../providers/ProviderSetupView.tsx';

interface ProviderStepProps {
  providers: ProviderSetup[];
  advisors: AdvisorSetup[];
  defaultProvider: ProviderId | null;
  onVerifyStart: () => void;
  onVerifyOutcome: (outcome: 'success' | 'failure') => void;
}

function CliNames({ providers }: { providers: ProviderSetup[] }) {
  const clis = providers
    .filter((provider) => provider.cli && provider.methods.includes('cli'))
    .map((provider) => provider.cli);
  return (
    <>
      the{' '}
      {clis.map((cli, index) => (
        <span key={cli}>
          {index > 0 && (index === clis.length - 1 ? ' or ' : ', ')}
          <code>{cli}</code>
        </span>
      ))}{' '}
      CLI
    </>
  );
}

export function ProviderStep({
  providers,
  advisors,
  defaultProvider,
  onVerifyStart,
  onVerifyOutcome,
}: ProviderStepProps) {
  const [openId, setOpenId] = useState<ConnectableId | null>(null);
  return (
    <>
      <h2 id="onbTitle">Connect your AI providers</h2>
      <p className="lede">
        Open a provider to connect it and pick its defaults. If you connect more than one, the
        default starts new chats. You can add others anytime.
      </p>
      <p className="set-hint onb-needs">
        You need one of these: <CliNames providers={providers} /> installed and signed in, or an API
        key. Spark checks for Git on the next step.
      </p>
      <ProviderSetupView
        providers={providers}
        openId={openId}
        onOpenChange={setOpenId}
        advisors={advisors}
        defaultProvider={defaultProvider}
        onVerifyStart={onVerifyStart}
        onVerifyOutcome={onVerifyOutcome}
      />
    </>
  );
}
