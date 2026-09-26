import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import type {
  AdvisorSetup,
  ConnectionMethod,
  ProviderSetup,
  VerifyFailureCode,
  VerifyRequest,
} from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import { setupApi, setupKey, verifyProvider } from '../api/setup.ts';
import { ProviderBlob } from '../brand/ProviderBlob.tsx';
import type { BlobExpression } from '../brand/blob-expression.ts';
import { ChevronIcon, CheckIcon, KeyIcon, TerminalIcon } from '../ui/icons.tsx';
import { burstAt } from '../ui/sparks.ts';
import { fadeReveal } from '../ui/transitions.tsx';
import { TerminalPanel } from '../terminal/TerminalPanel.tsx';
import { AdvisorSummary } from './AdvisorSummary.tsx';
import { MethodPanel } from './MethodPanel.tsx';
import { ConnectedSummary } from './ConnectedSummary.tsx';
import { VerifyLog } from './VerifyLog.tsx';
import { appendLogLine, methodLabel, resolveLastLine, type VerifyLogLine } from './verify-log.ts';
import '../ui/controls.css';
import './providers.css';

type CardSetup = ProviderSetup | AdvisorSetup;

const isAdvisor = (setup: CardSetup): setup is AdvisorSetup => 'role' in setup;

interface ProviderCardProps {
  provider: CardSetup;
  open: boolean;
  isDefault?: boolean;
  canMakeDefault?: boolean;
  onToggle: () => void;
  onVerifyStart?: () => void;
  onVerifyOutcome?: (outcome: 'success' | 'failure') => void;
}

type ProviderMood = Extract<BlobExpression, 'idle' | 'thinking' | 'happy' | 'sad'>;

export function ProviderCard({
  provider,
  open,
  isDefault = false,
  canMakeDefault = false,
  onToggle,
  onVerifyStart,
  onVerifyOutcome,
}: ProviderCardProps) {
  const queryClient = useQueryClient();
  const connection = provider.connection;
  const [method, setMethod] = useState<ConnectionMethod>(
    connection?.method ?? provider.methods[0] ?? 'cli',
  );
  const [changing, setChanging] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [log, setLog] = useState<VerifyLogLine[]>([]);
  const [mood, setMood] = useState<ProviderMood>('idle');
  const [celebrate, setCelebrate] = useState(false);
  const [shake, setShake] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalRun, setTerminalRun] = useState(0);
  const [failureCode, setFailureCode] = useState<VerifyFailureCode | null>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const nextLineId = useRef(0);

  useEffect(() => {
    if (!celebrate) return;
    const timeout = setTimeout(() => setCelebrate(false), 1100);
    return () => clearTimeout(timeout);
  }, [celebrate]);

  useEffect(() => {
    if (!shake) return;
    const timeout = setTimeout(() => setShake(false), 400);
    return () => clearTimeout(timeout);
  }, [shake]);

  function openTerminal() {
    setTerminalRun((run) => run + 1);
    setTerminalOpen(true);
  }

  function signInAgain() {
    setReauth(true);
    setChanging(true);
    setMethod('cli');
    setLog([]);
    setFailureCode('not_logged_in');
    openTerminal();
  }

  function handleMethodChange(next: ConnectionMethod) {
    setMethod(next);
    setTerminalOpen(false);
    setLog([]);
    setShowKey(false);
  }

  async function handleVerify() {
    setLog([]);
    setVerifying(true);
    setMood('thinking');
    setDisconnectError(null);
    onVerifyStart?.();
    const body: VerifyRequest =
      method === 'api_key' ? { method: 'api_key', apiKey: apiKey.trim() } : { method: 'cli' };

    setFailureCode(null);
    const fail = (label: string, code?: VerifyFailureCode) => {
      setFailureCode(code ?? null);
      setLog((lines) => resolveLastLine(lines, label, 'bad'));
      setVerifying(false);
      setMood('sad');
      setShake(true);
      if (body.method === 'cli') openTerminal();
      onVerifyOutcome?.('failure');
    };

    try {
      await verifyProvider(provider.id, body, (event) => {
        if (event.type === 'step_started') {
          nextLineId.current += 1;
          const lineId = nextLineId.current;
          setLog((lines) => appendLogLine(lines, lineId, event.label));
        } else if (event.type === 'step_succeeded') {
          setLog((lines) => resolveLastLine(lines, event.label, 'good'));
        } else if (event.type === 'step_failed') {
          fail(event.label, event.code);
        } else if (event.type === 'connected') {
          void handleConnected();
        }
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Verification could not finish.');
    }
  }

  async function handleConnected() {
    setTerminalOpen(false);
    await queryClient.invalidateQueries({ queryKey: setupKey });
    setVerifying(false);
    setChanging(false);
    setReauth(false);
    setApiKey('');
    setCelebrate(true);
    setMood('happy');
    onVerifyOutcome?.('success');
    requestAnimationFrame(() => burstAt(pillRef.current, 18, 60));
    setTimeout(() => setMood('idle'), 3000);
  }

  async function handleDisconnect() {
    try {
      const state = await setupApi.disconnect(provider.id);
      queryClient.setQueryData(setupKey, state);
      setDisconnectError(null);
    } catch (error) {
      if (error instanceof ApiError) {
        setDisconnectError(error.message);
        setShake(true);
        return;
      }
      throw error;
    }
  }

  const methodIndex = provider.methods.indexOf(method);
  const cliFailed = method === 'cli' && log.at(-1)?.status === 'bad';
  const cliButtonLabel =
    method === 'cli' && log.at(-1)?.status === 'bad' ? 'Try again' : 'Detect and verify';
  const cardClasses = [
    'pcard',
    open ? 'open' : '',
    connection ? 'connected' : '',
    celebrate ? 'celebrate' : '',
    shake ? 'nope' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClasses} data-prov={provider.id}>
      <button type="button" className="pc-head" aria-expanded={open} onClick={onToggle}>
        <span className="plogo">
          <ProviderBlob
            providerId={provider.id}
            size={42}
            expression={mood}
            animate={open ? 'always' : 'hover'}
          />
        </span>
        <span className="nm">
          <b>
            {provider.name}
            {isDefault && <span className="tag-default">Default</span>}
          </b>
          <small>
            {connection
              ? `Connected with ${methodLabel(connection.method)}`
              : `by ${provider.maker}`}
          </small>
        </span>
        {connection && (
          <span className="pill-ok" ref={pillRef}>
            <CheckIcon />
            Connected
          </span>
        )}
        <ChevronIcon />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" className="pc-collapse" {...fadeReveal}>
            <div className="pc-body">
              {isAdvisor(provider) && provider.connection && !changing ? (
                <AdvisorSummary
                  advisor={provider}
                  connection={provider.connection}
                  errorMessage={disconnectError}
                  onChange={() => setChanging(true)}
                  onDisconnect={handleDisconnect}
                />
              ) : !isAdvisor(provider) && provider.connection && !changing ? (
                <ConnectedSummary
                  provider={provider}
                  connection={provider.connection}
                  errorMessage={disconnectError}
                  canMakeDefault={canMakeDefault}
                  onSignInAgain={signInAgain}
                  onChange={() => setChanging(true)}
                  onDisconnect={handleDisconnect}
                />
              ) : (
                <>
                  {reauth ? (
                    <p className="chg-note">
                      Signing in to {provider.name} again. Your settings stay as they are.{' '}
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          setReauth(false);
                          setChanging(false);
                          setTerminalOpen(false);
                        }}
                      >
                        Cancel
                      </button>
                    </p>
                  ) : (
                    <>
                      {connection && (
                        <p className="chg-note">
                          Connected with {methodLabel(connection.method)}. Verifying a new method
                          replaces it.{' '}
                          <button type="button" className="link" onClick={() => setChanging(false)}>
                            Keep current
                          </button>
                        </p>
                      )}
                      <div
                        className="methods"
                        role="tablist"
                        aria-label={`How to connect ${provider.name}`}
                      >
                        <span
                          className="m-ind"
                          style={{ transform: `translateX(${methodIndex * 100}%)` }}
                          aria-hidden="true"
                        />
                        {provider.methods.map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="tab"
                            aria-selected={m === method}
                            onClick={() => handleMethodChange(m)}
                            disabled={verifying}
                          >
                            {m === 'cli' ? <TerminalIcon /> : <KeyIcon />}
                            <span>{m === 'cli' ? 'Local CLI' : 'API key'}</span>
                          </button>
                        ))}
                      </div>
                      <MethodPanel
                        provider={provider}
                        method={method}
                        apiKey={apiKey}
                        onApiKeyChange={setApiKey}
                        showKey={showKey}
                        onToggleShowKey={() => setShowKey((value) => !value)}
                        disabled={verifying}
                        cliButtonLabel={cliButtonLabel}
                        onVerify={handleVerify}
                        onOpenTerminal={
                          cliFailed && !terminalOpen && !verifying ? openTerminal : undefined
                        }
                      />
                    </>
                  )}
                  {!terminalOpen && <VerifyLog lines={log} />}
                  <AnimatePresence mode="wait">
                    {terminalOpen && method === 'cli' && !isAdvisor(provider) && (
                      <motion.div key={terminalRun} className="pc-collapse" {...fadeReveal}>
                        <TerminalPanel
                          provider={provider.id}
                          providerName={provider.name}
                          reason={
                            reauth
                              ? null
                              : (log.findLast((line) => line.status === 'bad')?.label ?? null)
                          }
                          step={failureCode === 'not_logged_in' ? 'login' : 'install'}
                          onCheckAgain={() => {
                            setTerminalOpen(false);
                            void handleVerify();
                          }}
                          onDismiss={() => setTerminalOpen(false)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
