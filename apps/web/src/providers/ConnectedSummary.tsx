import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import type { ProviderConnection, ProviderSetup } from '@spark-outpost/contracts';
import { setupApi, setupKey } from '../api/setup.ts';
import { relativeTime } from '../ui/relative-time.ts';
import { easeOut } from '../ui/transitions.tsx';
import { LabelText } from './LabelText.tsx';
import { MoreMenu } from './MoreMenu.tsx';
import { ProviderDefaults } from './ProviderDefaults.tsx';
import { TestPing } from './TestPing.tsx';

interface ConnectedSummaryProps {
  provider: ProviderSetup;
  connection: ProviderConnection;
  errorMessage: string | null;
  canMakeDefault: boolean;
  onSignInAgain: () => void;
  onChange: () => void;
  onDisconnect: () => void;
}

export function Detail({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

function LastTest({
  providerId,
  connection,
  pending,
  error,
}: {
  providerId: ProviderSetup['id'];
  connection: ProviderConnection;
  pending: boolean;
  error: string | null;
}) {
  if (pending) {
    return (
      <span className="test-pending">
        <TestPing providerId={providerId} />
        <span className="sr-only">Sending a test message</span>
      </span>
    );
  }
  if (error) return <span className="test-bad">{error}</span>;
  const last = connection.lastTest;
  if (!last) return <span className="muted">Not sent yet</span>;
  return (
    <span className={last.ok ? 'test-good' : 'test-bad'}>
      <LabelText label={last.message} /> · {relativeTime(last.testedAt)}
    </span>
  );
}

export function ConnectedSummary({
  provider,
  connection,
  errorMessage,
  canMakeDefault,
  onSignInAgain,
  onChange,
  onDisconnect,
}: ConnectedSummaryProps) {
  const queryClient = useQueryClient();
  const test = useMutation({
    mutationFn: () => setupApi.sendTestMessage(provider.id),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  const makeDefault = useMutation({
    mutationFn: () => setupApi.updateProfile({ defaultProvider: provider.id }),
    onSuccess: (state) => queryClient.setQueryData(setupKey, state),
  });
  const isKey = connection.method === 'api_key';

  return (
    <>
      <div className="conn-sum">
        <section className="conn-section" aria-label="Connection">
          <dl className="conn-details">
            {isKey ? (
              <Detail term="Key">
                <code>{connection.detail}</code>
              </Detail>
            ) : (
              <Detail term="CLI">
                <code>{connection.detail}</code>
              </Detail>
            )}
            {!isKey && connection.summary && <Detail term="Login">{connection.summary}</Detail>}
            <Detail term="Checked">
              {isKey ? `Verified with ${provider.maker} ` : ''}
              {relativeTime(connection.verifiedAt)}
            </Detail>
            <Detail term="Last test">
              <span aria-live="polite">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={test.isPending ? 'pending' : (connection.lastTest?.testedAt ?? 'none')}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2, ease: easeOut }}
                  >
                    <LastTest
                      providerId={provider.id}
                      connection={connection}
                      pending={test.isPending}
                      error={test.isError ? test.error.message : null}
                    />
                  </motion.span>
                </AnimatePresence>
              </span>
            </Detail>
          </dl>
        </section>
        <ProviderDefaults provider={provider} connection={connection} />
        <div className="conn-actions">
          <button
            type="button"
            className="btn sm line"
            onClick={() => test.mutate()}
            disabled={test.isPending}
          >
            {test.isPending ? 'Sending…' : 'Send test message'}
          </button>
          <MoreMenu
            label={`More ${provider.name} actions`}
            actions={[
              ...(canMakeDefault
                ? [
                    {
                      label: 'Make default',
                      hint: 'New chats start with this provider',
                      onSelect: () => makeDefault.mutate(),
                    },
                  ]
                : []),
              ...(!isKey
                ? [
                    {
                      label: 'Sign in again',
                      hint: `Opens a terminal to sign in to ${provider.name}`,
                      onSelect: onSignInAgain,
                    },
                  ]
                : []),
              {
                label: 'Change how it connects',
                hint: !provider.methods.includes('cli')
                  ? 'Use a new key'
                  : isKey
                    ? 'Use the local CLI or a new key'
                    : 'Use an API key instead',
                onSelect: onChange,
              },
              { label: 'Disconnect', danger: true, onSelect: onDisconnect },
            ]}
          />
        </div>
      </div>
      {errorMessage && <div className="hintline bad">{errorMessage}</div>}
    </>
  );
}
