import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  isTrackedTerminalProvider,
  terminalProviderName,
  type ConversationDetail,
  type ConversationSummary,
} from '@spark-outpost/contracts';
import { CAPABILITIES_STALE_MS, capabilitiesQuery, queryKeys } from '../api/client.ts';
import { ApprovalCard } from '../chat/approvals/ApprovalCard.tsx';
import { OpenRailFlags } from '../chat/approvals/RailFlags.tsx';
import { useLinkedProjects } from '../chat/project/use-chat-repos.ts';
import { HoldToConfirm } from '../ui/HoldToConfirm.tsx';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { MAC } from '../ui/shortcuts.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import type { BrowserHome } from '../browser/use-view-placement.ts';
import { DependenciesNotice } from './DependenciesNotice.tsx';
import { TERMINAL_NOT_RUNNING, TERMINAL_WAITING } from './draft-target.ts';
import { RestartNotice } from './RestartNotice.tsx';
import { useTerminalLinks } from './use-terminal-links.tsx';
import { nativeTerminalApi, nativeTerminalKey } from './terminal-api.ts';
import { loadTerminalLive, sessionOf } from './terminal-live.ts';
import { terminalUsageKey } from './usage/terminal-usage-api.ts';
import { shownSession, terminalEnded, terminalRelaunch } from './native-state.ts';
import { TerminalBar, type TerminalLink } from './TerminalBar.tsx';
import { TerminalDictation } from '../voice/TerminalDictation.tsx';
import { TerminalMenu } from './TerminalMenu.tsx';
import { TerminalScreen } from './TerminalScreen.tsx';
import { RemoteTerminalView } from './remote/RemoteTerminalView.tsx';
import { useTerminalFocus, type FocusPanel } from './use-terminal-focus.ts';
import './native-terminal.css';

const PATH_COPIED = 'Folder path copied';
const PATH_NOT_COPIED = 'Could not copy the folder path';
const SELECT_HINT = MAC ? 'Hold Option to select' : 'Hold Shift to select';

export function NativeTerminalWorkspace({
  chat,
  detail,
  panel = null,
  browserHome = null,
}: {
  chat: ConversationSummary;
  detail: ConversationDetail;
  panel?: FocusPanel | null;
  browserHome?: BrowserHome | null;
}) {
  const client = useQueryClient();
  const { remote } = useRemoteClient();
  const session = useQuery({
    queryKey: nativeTerminalKey(chat.id),
    queryFn: async () => {
      const live = await loadTerminalLive(chat.id);
      if (live.usage) client.setQueryData(terminalUsageKey(chat.id), live.usage);
      return sessionOf(live);
    },
    refetchInterval: 2000,
    enabled: !remote,
  });
  const [link, setLink] = useState<TerminalLink>('connecting');
  const [attempt, setAttempt] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [exited, setExited] = useState(false);
  const [mouseReporting, setMouseReporting] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const stopGroup = useRef<HTMLDivElement>(null);
  const rejoined = useRef<string | null>(null);
  const reported = session.data ?? chat.terminal ?? null;
  const native = reported ? shownSession(reported, exited) : null;
  const ended = native ? terminalEnded(native) : false;
  const relaunch = reported ? terminalRelaunch(reported, chat.latestRun?.status ?? null) : null;
  const showsScreen = !session.isPending && (!ended || opened);
  const repos = useLinkedProjects(chat.projectIds);
  const links = useTerminalLinks(browserHome, repos);
  const tracked = native && isTrackedTerminalProvider(native.provider) ? native.provider : null;
  const capabilities = useQuery({
    ...capabilitiesQuery(tracked ?? 'claude'),
    staleTime: CAPABILITIES_STALE_MS,
    enabled: !remote && tracked !== null,
  });
  const focus = useTerminalFocus(chat.id, panel, !remote);
  const pending = detail.approvals.filter((approval) => approval.status === 'pending');
  const waiting =
    native?.state === 'waiting_for_permission' || native?.state === 'waiting_for_input';
  const draftRefusal = ended ? TERMINAL_NOT_RUNNING : waiting ? TERMINAL_WAITING : null;
  useEffect(() => {
    if (confirm) stopGroup.current?.querySelector<HTMLElement>('button')?.focus();
  }, [confirm]);
  const refresh = async () => {
    await Promise.all([
      session.refetch(),
      client.invalidateQueries({ queryKey: queryKeys.conversations }),
      client.invalidateQueries({ queryKey: queryKeys.conversation(chat.id) }),
    ]);
  };
  const reconnect = () => {
    setProblem(null);
    setCopied(null);
    setLink('connecting');
    setExited(false);
    setAttempt((value) => value + 1);
  };
  const restartedAt = reported?.readopted?.at ?? null;
  const reconnectAfterRestart = useStableCallback(reconnect);
  useEffect(() => {
    if (restartedAt && link === 'disconnected' && rejoined.current !== restartedAt) {
      rejoined.current = restartedAt;
      reconnectAfterRestart();
    }
  }, [restartedAt, link, reconnectAfterRestart]);
  const act = async (action: 'resume' | 'restart' | 'stop') => {
    if (!native || busy) return;
    setBusy(true);
    setProblem(null);
    setCopied(null);
    try {
      if (action === 'stop') await nativeTerminalApi.stop(chat.id);
      else await nativeTerminalApi.launch(chat.id, action === 'resume' ? { resume: true } : {});
      setConfirm(false);
      await refresh();
      if (action !== 'stop') {
        setOpened(false);
        setExited(false);
        setMouseReporting(false);
        setLink('connecting');
        setAttempt((value) => value + 1);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The session could not be updated.');
    } finally {
      setBusy(false);
    }
  };
  const copyPath = (cwd: string) =>
    void navigator.clipboard.writeText(cwd).then(
      () => setCopied(PATH_COPIED),
      () => setCopied(PATH_NOT_COPIED),
    );
  if (remote) return <RemoteTerminalView chat={chat} />;
  const reason = native?.reason && native.observation !== 'unsupported' ? native.reason : null;
  return (
    <section
      className={focus.focused ? 'native-workspace focused' : 'native-workspace'}
      aria-label="Terminal session"
    >
      <TerminalBar
        chat={chat}
        native={native}
        link={ended ? null : link}
        repos={repos}
        capabilities={capabilities.data}
        note={copied ?? reason}
        hint={mouseReporting && !ended ? SELECT_HINT : null}
        focus={focus}
      >
        {!ended && link === 'disconnected' && (
          <button type="button" className="btn ghost sm" onClick={reconnect}>
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
        {native && !ended && (
          <TerminalDictation chatId={chat.id} agentName={terminalProviderName(native.provider)} />
        )}
        <TerminalMenu
          buttonRef={menuButton}
          onCopyPath={native ? () => copyPath(native.cwd) : null}
          onReconnect={!ended && showsScreen ? reconnect : null}
          onStop={!ended && native && !busy ? () => setConfirm(true) : null}
        />
      </TerminalBar>
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
      {native && !ended && <RestartNotice session={native} />}
      {native && <DependenciesNotice session={native} />}
      {ended && showsScreen && (
        <p className="native-note" role="status">
          This terminal session has stopped. Its last output is shown below.
        </p>
      )}
      <div className="native-stage">
        {showsScreen ? (
          <TerminalScreen
            chatId={chat.id}
            attempt={attempt}
            onConnected={() => {
              setOpened(true);
              setLink('connected');
              void session.refetch();
            }}
            onDisconnected={() => setLink('disconnected')}
            onInputError={setProblem}
            onError={(message) => {
              setProblem(message);
              setLink('disconnected');
            }}
            onMouseReporting={setMouseReporting}
            links={links.opener}
            draftRefusal={draftRefusal}
            onEnded={() => {
              setExited(true);
              setLink('disconnected');
              void refresh();
            }}
          />
        ) : (
          <div className="native-detached">
            <p>{session.isPending ? 'Opening terminal…' : 'This terminal session has stopped.'}</p>
            {native?.reason && <p>{native.reason}</p>}
          </div>
        )}
        {confirm && (
          <div
            ref={stopGroup}
            className="native-stop"
            role="group"
            aria-label="Stop terminal session"
          >
            <p>Stop the agent and everything it started?</p>
            <HoldToConfirm
              label="Hold to stop"
              hint="Press and hold for 1.5 seconds."
              holdingHint="Keep holding. Let go to cancel."
              releasedHint="Released early. The session is still running."
              onConfirm={() => void act('stop')}
              adornment={
                <button
                  type="button"
                  className="btn line"
                  onClick={() => {
                    setConfirm(false);
                    menuButton.current?.focus();
                  }}
                >
                  Keep running
                </button>
              }
            />
          </div>
        )}
      </div>
      {links.menu}
      {pending.length > 0 && (
        <div className="native-approvals" role="group" aria-label="Waiting for your approval">
          {pending.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              provider={tracked ?? 'claude'}
              repo={null}
            />
          ))}
        </div>
      )}
      <OpenRailFlags detail={detail} />
    </section>
  );
}
