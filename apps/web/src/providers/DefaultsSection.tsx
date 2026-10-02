import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdvisorSetup, ProviderSetup } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { Detail } from './Detail.tsx';
import { ProviderDefaults } from './ProviderDefaults.tsx';

const JEV_SENDS =
  'Your request, the previous request and a short summary of the task it may continue, and the text of files you attach (only to check it for instructions aimed at the agent). With code diffs on, also the diff of each proposed edit and the final diff. Never keys or tool output. TypeSafe does not train on it.';

function DefaultChoice({
  provider,
  isDefault,
  canMakeDefault,
}: {
  provider: ProviderSetup;
  isDefault: boolean;
  canMakeDefault: boolean;
}) {
  const queryClient = useQueryClient();
  const makeDefault = useMutation({
    mutationFn: () => setupApi.updateProfile({ defaultProvider: provider.id }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  if (isDefault) {
    return <p className="pconf-muted">New chats start with {provider.name}.</p>;
  }
  if (!canMakeDefault) return null;
  return (
    <div className="pconf-actions">
      <button
        type="button"
        className="btn line sm"
        onClick={() => makeDefault.mutate()}
        disabled={makeDefault.isPending}
      >
        Make default
      </button>
      <small className="pconf-muted">New chats start with this provider.</small>
    </div>
  );
}

function AdvisorDefaults({ advisor, settings }: { advisor: AdvisorSetup; settings: ReactNode }) {
  const connection = advisor.connection;
  return (
    <>
      <dl className="conn-details">
        <Detail term="Model">
          {connection?.model ? <code>{connection.model}</code> : <span className="muted">—</span>}
        </Detail>
        <Detail term="Role">
          {advisor.role}
          <small className="note">
            On Auto, its ratings feed a score that code uses to pick the model. The rules decide
            whenever Jev is unsure.
          </small>
        </Detail>
        <Detail term="Sends">{JEV_SENDS}</Detail>
      </dl>
      {settings}
    </>
  );
}

interface DefaultsSectionProps {
  setup: ProviderSetup | AdvisorSetup;
  isDefault: boolean;
  canMakeDefault: boolean;
  advisorSettings?: ReactNode;
}

export function DefaultsSection({
  setup,
  isDefault,
  canMakeDefault,
  advisorSettings,
}: DefaultsSectionProps) {
  if ('role' in setup) return <AdvisorDefaults advisor={setup} settings={advisorSettings} />;
  if (!setup.connection) {
    return (
      <p className="pconf-muted">
        Connect {setup.name} to pick its model, mode and effort for new chats.
      </p>
    );
  }
  return (
    <>
      <ProviderDefaults provider={setup} connection={setup.connection} />
      <DefaultChoice provider={setup} isDefault={isDefault} canMakeDefault={canMakeDefault} />
    </>
  );
}
