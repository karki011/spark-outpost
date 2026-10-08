import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail, ConversationSummary } from '@spark-outpost/contracts';
import { queryKeys } from '../api/client.ts';
import { ApprovalCard } from '../chat/approvals/ApprovalCard.tsx';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { nativeTerminalApi } from './terminal-api.ts';
import { openTerminal } from './terminal-connection.ts';
import { terminalEnded, terminalLabel, terminalRelaunch } from './native-state.ts';
import { TerminalCompanion } from './TerminalCompanion.tsx';
import './native-terminal.css';

function TerminalScreen({
  chatId,
  attempt,
  onConnected,
  onDisconnected,
  onError,
  onInputError,
  onEnded,
}: {
  chatId: string;
  attempt: number;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: (message: string) => void;
  onInputError: (message: string) => void;
  onEnded: () => void;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onConnected, onDisconnected, onError, onInputError, onEnded });
  useEffect(() => {
    callbacks.current = { onConnected, onDisconnected, onError, onInputError, onEnded };
  });
  useEffect(() => {
    if (!screen.current) return;
    const connection = openTerminal(
      async () => {
        const session = await nativeTerminalApi.get(chatId);
        if (!session) return (await nativeTerminalApi.launch(chatId)).connection;
        if (terminalEnded(session))
          throw new Error('This session has ended. Resume it explicitly when available.');
        return nativeTerminalApi.attach(session.id);
      },
      screen.current,
      {
        preserveSession: true,
        onOpen: () => callbacks.current.onConnected(),
        onDisconnected: () => callbacks.current.onDisconnected(),
        onError: (message) => callbacks.current.onError(message),
        onInputError: (message) => callbacks.current.onInputError(message),
        onEnded: () => callbacks.current.onEnded(),
      },
    );
    return () => connection.dispose();
  }, [chatId, attempt]);
  return (
    <div
      className="native-screen term-screen"
      ref={screen}
      aria-label="Interactive agent terminal"
    />
  );
}

export function NativeTerminalWorkspace({
  chat,
  detail,
}: {
  chat: ConversationSummary;
  detail: ConversationDetail;
}) {
  const client = useQueryClient();
  const { remote } = useRemoteClient();
  const session = useQuery({
    queryKey: ['native-terminal', chat.id],
    queryFn: () => nativeTerminalApi.get(chat.id),
    refetchInterval: 2000,
    enabled: !remote,
  });
  const [shown, setShown] = useState(true);
  const [connectionState, setConnectionState] = useState<
    'connecting' | 'connected' | 'disconnected'
  >('connecting');
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const native = session.data ?? chat.terminal;
  const state = native?.state ?? 'starting';
  const ended = native ? terminalEnded(native) : false;
  const relaunch = native ? terminalRelaunch(native, chat.latestRun?.status ?? null) : null;
  const showsScreen = shown && !session.isPending && (!ended || opened);
  const refresh = async () => {
    await Promise.all([
      session.refetch(),
      client.invalidateQueries({ queryKey: queryKeys.conversations }),
      client.invalidateQueries({ queryKey: queryKeys.conversation(chat.id) }),
    ]);
  };
  const act = async (action: 'resume' | 'restart' | 'stop') => {
    if (!native || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      if (action === 'stop') await nativeTerminalApi.stop(chat.id);
      else await nativeTerminalApi.launch(chat.id, action === 'resume' ? { resume: true } : {});
      setConfirm(false);
      await refresh();
      if (action !== 'stop') {
        setShown(true);
        setOpened(false);
        setConnectionState('connecting');
        setAttempt((value) => value + 1);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The session could not be updated.');
    } finally {
      setBusy(false);
    }
  };
  if (remote)
    return (
      <section className="native-workspace">
        <p>Open this Terminal session on your Mac.</p>
      </section>
    );
  return (
    <section className="native-workspace" aria-label="Terminal session">
      <div className="native-status">
        <TerminalCompanion chat={chat} state={state} />
        <div>
          <b>
            {native?.provider === 'codex' ? 'Codex' : 'Claude Code'}{' '}
            <span aria-hidden="true">&gt;_</span>
          </b>
          <p role="status">
            {terminalLabel(state)}
            {shown && connectionState !== 'connected' && !ended
              ? ` · ${connectionState === 'connecting' ? 'Connecting' : 'Disconnected'}`
              : ''}
          </p>
        </div>
        <div className="native-controls">
          {!ended && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setShown(!shown);
                setConnectionState('connecting');
              }}
            >
              {shown ? 'Hide view' : 'Open terminal'}
            </button>
          )}
          {!ended && shown && connectionState === 'disconnected' && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => {
                setProblem(null);
                setConnectionState('connecting');
                setAttempt((value) => value + 1);
              }}
            >
              Reconnect
            </button>
          )}
          {relaunch && (
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={() => void act(relaunch)}
            >
              {relaunch === 'resume' ? 'Resume session' : 'Start again'}
            </button>
          )}
          {!ended && (
            <button
              type="button"
              className="btn line sm"
              disabled={!native || busy}
              onClick={() => setConfirm(true)}
            >
              Stop session
            </button>
          )}
        </div>
      </div>
      {native?.reason && native.observation !== 'unsupported' && (
        <p className="native-note" role="status">
          {native.reason}
        </p>
      )}
      {native?.cwd && (
        <div className="native-cwd" title={native.cwd}>
          {native.cwd}
        </div>
      )}
      {confirm && (
        <div className="native-stop" role="group" aria-label="Stop terminal session">
          <p>Stop the agent and everything it started?</p>
          <HoldToConfirm
            label="Hold to stop"
            hint="Press and hold for 1.5 seconds."
            holdingHint="Keep holding. Let go to cancel."
            releasedHint="Released early. The session is still running."
            onConfirm={() => void act('stop')}
            adornment={
              <button type="button" className="btn line" onClick={() => setConfirm(false)}>
                Keep running
              </button>
            }
          />
        </div>
      )}
      {problem && (
        <p className="error-line" role="alert">
          {problem}
        </p>
      )}
      {session.isError && (
        <p className="error-line" role="alert">
          {session.error.message}
        </p>
      )}
      {ended && showsScreen && (
        <p className="native-note" role="status">
          This terminal session has stopped. Its last output is shown below.
        </p>
      )}
      {showsScreen ? (
        <TerminalScreen
          chatId={chat.id}
          attempt={attempt}
          onConnected={() => {
            setOpened(true);
            setConnectionState('connected');
            void session.refetch();
          }}
          onDisconnected={() => setConnectionState('disconnected')}
          onInputError={setProblem}
          onError={(message) => {
            setProblem(message);
            setConnectionState('disconnected');
          }}
          onEnded={() => {
            setConnectionState('disconnected');
            void refresh();
          }}
        />
      ) : (
        <div className="native-detached">
          <p>
            {session.isPending
              ? 'Opening terminal…'
              : ended
                ? 'This terminal session has stopped.'
                : 'The terminal view is hidden. Your agent keeps running.'}
          </p>
          {native?.reason && <p>{native.reason}</p>}
        </div>
      )}
      <div className="native-approvals">
        {detail.approvals
          .filter((approval) => approval.status === 'pending')
          .map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              provider={native?.provider ?? 'claude'}
              repo={null}
            />
          ))}
      </div>
    </section>
  );
}
