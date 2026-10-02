import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AdvisorSetup,
  ConnectionMethod,
  ProviderSetup,
  VerifyFailureCode,
  VerifyRequest,
} from '@spark-outpost/contracts';
import { setupKey, verifyProvider } from '../api/setup.ts';
import type { BlobExpression } from '../brand/blob-expression.ts';
import type { VerifyFailure } from './tile-status.ts';
import { appendLogLine, resolveLastLine, type VerifyLogLine } from './verify-log.ts';

export type ProviderMood = Extract<BlobExpression, 'idle' | 'thinking' | 'happy' | 'sad'>;

export interface ConnectCallbacks {
  onVerifyStart?: (() => void) | undefined;
  onVerifyOutcome?: ((outcome: 'success' | 'failure') => void) | undefined;
  onFailure?: ((failure: VerifyFailure | null) => void) | undefined;
  onConnected?: (() => void) | undefined;
}

function useFlag(durationMs: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const timeout = setTimeout(() => setOn(false), durationMs);
    return () => clearTimeout(timeout);
  }, [on, durationMs]);
  return [on, () => setOn(true)] as const;
}

export function useProviderConnect(
  provider: ProviderSetup | AdvisorSetup,
  callbacks: ConnectCallbacks,
) {
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
  const [celebrate, startCelebrate] = useFlag(1100);
  const [shake, startShake] = useFlag(400);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalRun, setTerminalRun] = useState(0);
  const [failureCode, setFailureCode] = useState<VerifyFailureCode | null>(null);
  const nextLineId = useRef(0);
  const latest = useRef(callbacks);

  useEffect(() => {
    latest.current = callbacks;
  });

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

  function cancelReauth() {
    setReauth(false);
    setChanging(false);
    setTerminalOpen(false);
  }

  function changeMethod(next: ConnectionMethod) {
    setMethod(next);
    setTerminalOpen(false);
    setLog([]);
    setShowKey(false);
  }

  async function handleConnected() {
    setTerminalOpen(false);
    await queryClient.invalidateQueries({ queryKey: setupKey });
    setVerifying(false);
    setChanging(false);
    setReauth(false);
    setApiKey('');
    startCelebrate();
    setMood('happy');
    latest.current.onFailure?.(null);
    latest.current.onVerifyOutcome?.('success');
    latest.current.onConnected?.();
    setTimeout(() => setMood('idle'), 3000);
  }

  async function verify() {
    setLog([]);
    setVerifying(true);
    setMood('thinking');
    latest.current.onVerifyStart?.();
    const body: VerifyRequest =
      method === 'api_key' ? { method: 'api_key', apiKey: apiKey.trim() } : { method: 'cli' };

    setFailureCode(null);
    const fail = (label: string, code?: VerifyFailureCode) => {
      setFailureCode(code ?? null);
      setLog((lines) => resolveLastLine(lines, label, 'bad'));
      setVerifying(false);
      setMood('sad');
      startShake();
      if (body.method === 'cli' || code === 'cli_missing') openTerminal();
      latest.current.onFailure?.({ code: code ?? null, label });
      latest.current.onVerifyOutcome?.('failure');
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

  const cliFailed = method === 'cli' && log.at(-1)?.status === 'bad';

  return {
    method,
    changing,
    reauth,
    apiKey,
    showKey,
    verifying,
    log,
    mood,
    celebrate,
    shake,
    terminalOpen,
    terminalRun,
    failureCode,
    cliFailed,
    setApiKey,
    toggleShowKey: () => setShowKey((value) => !value),
    startChanging: () => setChanging(true),
    keepCurrent: () => setChanging(false),
    closeTerminal: () => setTerminalOpen(false),
    nudge: startShake,
    openTerminal,
    signInAgain,
    cancelReauth,
    changeMethod,
    verify,
  };
}

export type ProviderConnect = ReturnType<typeof useProviderConnect>;
