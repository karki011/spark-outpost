import { AnimatePresence, motion } from 'motion/react';
import type { AdvisorSetup, ProviderConnection, ProviderSetup } from '@spark-outpost/contracts';
import { relativeTime } from '../ui/relative-time.ts';
import { easeOut } from '../ui/transitions.tsx';
import { Detail } from './Detail.tsx';
import { LabelText } from './LabelText.tsx';
import { TestBubble } from './TestBubble.tsx';
import type { TestMessage } from './test-message.ts';
import type { ProviderConnect } from './use-provider-connect.ts';
import { VerifyLog } from './VerifyLog.tsx';

function LastTest({
  providerName,
  connection,
  pending,
  error,
}: {
  providerName: string;
  connection: ProviderConnection;
  pending: boolean;
  error: string | null;
}) {
  if (pending) return <span className="test-pending">Waiting for {providerName} to reply</span>;
  if (error) return <span className="test-bad">{error}</span>;
  const last = connection.lastTest;
  if (!last) return <span className="muted">Not sent yet</span>;
  return (
    <span className={last.ok ? 'test-good' : 'test-bad'}>
      <LabelText label={last.message} /> · {relativeTime(last.testedAt)}
    </span>
  );
}

function TestMessageRow({
  provider,
  connection,
  test,
}: {
  provider: ProviderSetup;
  connection: ProviderConnection;
  test: TestMessage;
}) {
  const asking = test.phase === 'asking';
  return (
    <>
      <dl className="conn-details">
        <Detail term="Last test">
          <span aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={asking ? 'pending' : (connection.lastTest?.testedAt ?? 'none')}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2, ease: easeOut }}
              >
                <LastTest
                  providerName={provider.name}
                  connection={connection}
                  pending={asking}
                  error={test.error}
                />
              </motion.span>
            </AnimatePresence>
          </span>
        </Detail>
      </dl>
      <div className="pconf-actions">
        <button
          type="button"
          className={asking ? 'btn sm line test-asking' : 'btn sm line'}
          onClick={() => {
            if (!asking) test.send(provider.id);
          }}
          aria-disabled={asking}
        >
          {asking ? `Asking ${provider.name}…` : 'Send test message'}
          {asking && test.elapsedSeconds > 0 && (
            <span className="test-elapsed">{test.elapsedSeconds} s</span>
          )}
        </button>
        <TestBubble phase={test.phase} />
      </div>
    </>
  );
}

interface TestSectionProps {
  setup: ProviderSetup | AdvisorSetup;
  connect: ProviderConnect;
  test: TestMessage;
}

export function TestSection({ setup, connect, test }: TestSectionProps) {
  const connection = setup.connection;
  const showLog = !connect.terminalOpen && connect.log.length > 0;
  const editing = !connection || connect.changing;
  return (
    <>
      {showLog && <VerifyLog lines={connect.log} />}
      {!editing && 'role' in setup && (
        <p className="pconf-muted">
          Jev was checked when its key was verified. Verify a new key to check it again.
        </p>
      )}
      {!editing && !('role' in setup) && connection && 'lastTest' in connection && (
        <TestMessageRow provider={setup} connection={connection} test={test} />
      )}
      {editing && !showLog && (
        <p className="pconf-muted">
          {connect.method === 'api_key'
            ? `Verify the key above. Each check ${setup.name} passes shows here.`
            : `Detect and verify above. Each check ${setup.name} passes shows here.`}
        </p>
      )}
    </>
  );
}
