import { AnimatePresence, motion } from 'motion/react';
import type { AdvisorConnection, AdvisorSetup, ProviderSetup } from '@spark-outpost/contracts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';
import { KeyIcon, TerminalIcon } from '../ui/icons.tsx';
import { relativeTime } from '../ui/relative-time.ts';
import { fadeReveal } from '../ui/transitions.tsx';
import { Detail } from './Detail.tsx';
import { EndpointPanel } from './EndpointPanel.tsx';
import { MethodPanel } from './MethodPanel.tsx';
import { ModelAccessDetails } from './ModelAccessDetails.tsx';
import type { ProviderConnect } from './use-provider-connect.ts';
import { isEndpoint, methodLabel, methodTitle } from './verify-log.ts';

type ConnectSetup = ProviderSetup | AdvisorSetup;

const isAdvisor = (setup: ConnectSetup): setup is AdvisorSetup => 'role' in setup;

function changeLabel(setup: ConnectSetup): string {
  if (isEndpoint(setup)) return 'Change endpoint';
  if (isAdvisor(setup) || !setup.methods.includes('cli')) return 'Use a new key';
  return setup.connection?.method === 'api_key'
    ? 'Use the local CLI or a new key'
    : 'Use an API key instead';
}

function EndpointDetails({ connection }: { connection: AdvisorConnection }) {
  const models = [...new Set(connection.models.map((model) => model.label))];
  return (
    <>
      <Detail term="Address">
        <code>{connection.detail}</code>
      </Detail>
      <Detail term="Models">{models.join(', ')}</Detail>
      {connection.summary && <Detail term="Key">{connection.summary}</Detail>}
    </>
  );
}

function ConnectedDetails({ setup, connect }: { setup: ConnectSetup; connect: ProviderConnect }) {
  const connection = setup.connection;
  if (!connection) return null;
  const isKey = connection.method === 'api_key';
  const endpoint = isEndpoint(setup);
  return (
    <>
      <dl className="conn-details">
        {endpoint ? (
          <EndpointDetails connection={connection} />
        ) : (
          <Detail term={isKey ? 'Key' : 'CLI'}>
            <code>{connection.detail}</code>
          </Detail>
        )}
        {!isKey && connection.summary && <Detail term="Login">{connection.summary}</Detail>}
        <Detail term="Checked">
          {isKey && !endpoint ? `Verified with ${setup.maker} ` : ''}
          {relativeTime(connection.verifiedAt)}
        </Detail>
        {!isAdvisor(setup) && <ModelAccessDetails provider={setup.id} />}
      </dl>
      <div className="pconf-actions">
        {!isKey && !isAdvisor(setup) && (
          <button type="button" className="btn line sm" onClick={connect.signInAgain}>
            Sign in again
          </button>
        )}
        <button type="button" className="btn line sm" onClick={connect.startChanging}>
          {changeLabel(setup)}
        </button>
      </div>
    </>
  );
}

function MethodTabs({ setup, connect }: { setup: ConnectSetup; connect: ProviderConnect }) {
  if (setup.methods.length < 2) return null;
  const index = setup.methods.indexOf(connect.method);
  return (
    <div className="methods" role="tablist" aria-label={`How to connect ${setup.name}`}>
      <span
        className="m-ind"
        style={{ transform: `translateX(${index * 100}%)` }}
        aria-hidden="true"
      />
      {setup.methods.map((method) => (
        <button
          key={method}
          type="button"
          role="tab"
          aria-selected={method === connect.method}
          onClick={() => connect.changeMethod(method)}
          disabled={connect.verifying}
        >
          {method === 'cli' ? <TerminalIcon /> : <KeyIcon />}
          <span>{methodTitle(method)}</span>
        </button>
      ))}
    </div>
  );
}

function ConnectForm({ setup, connect }: { setup: ConnectSetup; connect: ProviderConnect }) {
  const connection = setup.connection;
  if (connect.reauth) {
    return (
      <p className="chg-note">
        Signing in to {setup.name} again. Your settings stay as they are.{' '}
        <button type="button" className="link" onClick={connect.cancelReauth}>
          Cancel
        </button>
      </p>
    );
  }
  return (
    <>
      {connection && (
        <p className="chg-note">
          {!isEndpoint(setup)
            ? `Connected with ${methodLabel(connection.method)}. Verifying a new method replaces it.`
            : `Connected to ${connection.detail}. A successful test of new settings replaces it.`}{' '}
          <button type="button" className="link" onClick={connect.keepCurrent}>
            Keep current
          </button>
        </p>
      )}
      <MethodTabs setup={setup} connect={connect} />
      {!isAdvisor(setup) && isEndpoint(setup) ? (
        <EndpointPanel setup={setup} connect={connect} />
      ) : (
        <MethodPanel
          provider={setup}
          method={connect.method}
          apiKey={connect.apiKey}
          onApiKeyChange={connect.setApiKey}
          showKey={connect.showKey}
          onToggleShowKey={connect.toggleShowKey}
          disabled={connect.verifying}
          cliButtonLabel={connect.cliFailed ? 'Try again' : 'Detect and verify'}
          onVerify={() => void connect.verify()}
          onOpenTerminal={
            connect.cliFailed && !connect.terminalOpen && !connect.verifying
              ? connect.openTerminal
              : undefined
          }
        />
      )}
    </>
  );
}

export function ConnectSection({
  setup,
  connect,
  compact,
}: {
  setup: ConnectSetup;
  connect: ProviderConnect;
  compact: boolean;
}) {
  const editing = !setup.connection || connect.changing;
  const { remote } = useRemoteClient();
  const terminal =
    editing &&
    connect.terminalOpen &&
    (connect.method === 'cli' || connect.failureCode === 'cli_missing') &&
    !isAdvisor(setup);
  return (
    <>
      {!isAdvisor(setup) && setup.note && <p className="prov-note">{setup.note}</p>}
      {editing ? (
        <ConnectForm setup={setup} connect={connect} />
      ) : (
        <ConnectedDetails setup={setup} connect={connect} />
      )}
      {terminal && remote && (
        <p className="hintline" role="status">
          Finish signing in to {setup.name} on your Mac. The sign-in terminal only runs there.
        </p>
      )}
      <AnimatePresence mode="wait">
        {terminal && !remote && (
          <motion.div key={connect.terminalRun} className="pc-collapse" {...fadeReveal}>
            <TerminalPanel
              provider={setup.id}
              providerName={setup.name}
              reason={
                connect.reauth
                  ? null
                  : (connect.log.findLast((line) => line.status === 'bad')?.label ?? null)
              }
              step={connect.failureCode === 'not_logged_in' ? 'login' : 'install'}
              onCheckAgain={() => {
                connect.closeTerminal();
                void connect.verify();
              }}
              onDismiss={connect.closeTerminal}
              compact={compact}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
