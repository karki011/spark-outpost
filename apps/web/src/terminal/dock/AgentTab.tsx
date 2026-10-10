import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentTerminalLive, type AgentTerminal } from '@spark-outpost/contracts';
import { agentTerminalKeys, agentTerminalsApi } from '../../api/agent-terminals.ts';
import {
  agentTerminalMark,
  agentTerminalRowState,
} from '../../chat/commands/agent-terminal-model.ts';
import { CommandScreen } from '../../chat/commands/CommandScreen.tsx';
import '../../chat/commands/command-terminal.css';
import {
  useChatAgentTerminals,
  useNow,
  useStopAgentTerminal,
} from '../../chat/commands/use-agent-terminals.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { QueryWait } from '../../ui/loading/QueryWait.tsx';
import { Skeleton } from '../../ui/loading/Skeleton.tsx';
import {
  AGENT_TAB_MISSING,
  agentTabBlocked,
  agentTabBody,
  agentTabFoot,
  agentTabLabel,
  agentTabStatus,
} from './agent-tabs.ts';
import { AGENT_TAB_WORDS } from './command-tabs.ts';
import { connectAgentTab, retryAgentTab, syncCommandTab, type ShellTab } from './shell-store.ts';

const untouched = () => undefined;

function Head({ terminal }: { terminal: AgentTerminal }) {
  const mark = agentTerminalMark(terminal);
  const now = useNow(mark === 'live');
  return (
    <div className="cmd-tab-head">
      {mark === 'live' ? (
        <span className="spin" aria-hidden="true" />
      ) : (
        <span className="run-cmd-mark" aria-hidden="true">
          {mark === 'ok' ? <CheckIcon className="run-cmd-ok" /> : <XIcon />}
        </span>
      )}
      <code className="cmd-tab-line" title={terminal.command}>
        {terminal.command}
      </code>
      <span className="cmd-tab-chip">Run by the agent · read-only</span>
      <span className="cmd-tab-state">{agentTerminalRowState(terminal, now)}</span>
    </div>
  );
}

function Foot({ chatId, terminal }: { chatId: string; terminal: AgentTerminal }) {
  const { stopping, error, stop } = useStopAgentTerminal(chatId, terminal.id);
  return (
    <div className="cmd-tab-foot">
      <p role="status">
        {agentTabFoot(terminal)}
        {error && <span className="cmd-tab-error"> {error}</span>}
      </p>
      {agentTerminalLive(terminal.state) && (
        <button type="button" className="btn sm" disabled={stopping} onClick={stop}>
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      )}
    </div>
  );
}

interface AgentTabProps {
  chatId: string;
  tab: ShellTab;
  shown: boolean;
}

function Pane({ chatId, tab, terminalId, shown }: AgentTabProps & { terminalId: string }) {
  const queryClient = useQueryClient();
  const screen = useRef<HTMLDivElement>(null);
  const list = useChatAgentTerminals(chatId);
  const terminal = list.data?.find((other) => other.id === terminalId) ?? null;
  const live = terminal !== null && agentTerminalLive(terminal.state);
  const attached = tab.sessionId !== null;
  const loaded = useQuery({
    queryKey: agentTerminalKeys.output(chatId, terminalId),
    queryFn: () => agentTerminalsApi.output(chatId, terminalId),
    staleTime: Infinity,
    enabled: terminal !== null && !live && !attached,
  });
  const body = agentTabBody({
    terminal,
    searching: list.isPending,
    attached,
    notice: tab.notice,
    saved: loaded.data?.output ?? null,
  });

  const label = terminal ? agentTabLabel(terminal) : null;
  const status = agentTabStatus(terminal, list.isPending);
  const cwd = terminal?.cwd ?? null;
  useEffect(() => {
    syncCommandTab(chatId, tab.id, {
      label: label ?? (status === 'ended' ? 'Terminal' : null),
      cwd,
      status,
    });
  }, [chatId, tab.id, label, cwd, status]);

  const wantsView = shown && live && !attached && tab.notice === null;
  useEffect(() => {
    if (wantsView && screen.current) connectAgentTab(chatId, tab.id, screen.current);
  }, [wantsView, chatId, tab.id]);

  const blocked = tab.notice !== null;
  useEffect(() => {
    if (blocked) void queryClient.invalidateQueries({ queryKey: agentTerminalKeys.chat(chatId) });
  }, [blocked, chatId, queryClient]);

  return (
    <div
      className={`cmd-tab agent-tab ${terminal?.state ?? 'finding'}`}
      role="group"
      aria-label={`${label ?? 'Terminal'}, ${AGENT_TAB_WORDS}, read-only`}
      tabIndex={-1}
      data-mirror-focus=""
    >
      {terminal && <Head terminal={terminal} />}
      <div className="cmd-tab-body">
        <div className="agent-tab-screen" ref={screen} hidden={body !== 'screen'} />
        {body === 'finding' && <Skeleton label="Loading the terminal" rows={3} />}
        {body === 'missing' && <p className="cmd-tab-note">{AGENT_TAB_MISSING}</p>}
        {body === 'blocked' && (
          <p className="cmd-tab-note" role="alert">
            {agentTabBlocked(tab.notice ?? '')}{' '}
            <button type="button" className="btn sm" onClick={() => retryAgentTab(chatId, tab.id)}>
              Try again
            </button>
          </p>
        )}
        {body === 'loading' && (
          <QueryWait query={loaded} what="the saved output">
            <Skeleton label="Loading the saved output" rows={3} />
          </QueryWait>
        )}
        {body === 'empty' && <p className="cmd-tab-note">No output.</p>}
        {body === 'saved' && loaded.data && (
          <CommandScreen
            text={loaded.data.output}
            appended={loaded.data.output.length}
            epoch={0}
            tall={false}
            fill
            onTouched={untouched}
          />
        )}
      </div>
      {terminal && <Foot chatId={chatId} terminal={terminal} />}
    </div>
  );
}

export function AgentTab({ chatId, tab, shown }: AgentTabProps) {
  if (!tab.agentTerminalId) return null;
  return createPortal(
    <Pane chatId={chatId} tab={tab} terminalId={tab.agentTerminalId} shown={shown} />,
    tab.host,
  );
}
