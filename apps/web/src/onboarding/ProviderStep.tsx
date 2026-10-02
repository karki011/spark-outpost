import type { AdvisorSetup, ProviderId, ProviderSetup } from '@spark-outpost/contracts';
import { ProviderList } from '../providers/ProviderList.tsx';

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
  return (
    <>
      <h2 id="onbTitle">Connect your AI providers</h2>
      <p className="lede">
        Connect at least one provider and pick its defaults. If you connect more than one, the
        default starts new chats. You can add others anytime.
      </p>
      <p className="set-hint onb-needs">
        You need one of these: <CliNames providers={providers} /> installed and signed in, or an API
        key. Spark checks for Git on the next step.
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
