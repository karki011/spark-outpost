import { memo, use } from 'react';
import { agentTerminalLive, agentTerminalsRunningLine } from '@spark-outpost/contracts';
import { openAgentTab } from '../../terminal/dock/shell-store.ts';
import { CheckIcon, TerminalIcon, XIcon } from '../../ui/icons.tsx';
import {
  agentTerminalMark,
  agentTerminalRowState,
  agentTerminalSpoken,
  type AgentTerminalView,
} from './agent-terminal-model.ts';
import { CommandDockContext } from './command-dock.ts';
import { useNow, useStopAgentTerminal } from './use-agent-terminals.ts';
import './command-terminal.css';
import './agent-terminal-row.css';

function Mark({ terminal }: { terminal: AgentTerminalView }) {
  const mark = agentTerminalMark(terminal);
  if (mark === 'live') return <span className="spin" aria-hidden="true" />;
  return (
    <span className="run-cmd-mark" aria-hidden="true">
      {mark === 'ok' ? <CheckIcon className="run-cmd-ok" /> : <XIcon />}
    </span>
  );
}

function RowControls({ chatId, terminal }: { chatId: string; terminal: AgentTerminalView }) {
  const { stopping, error, stop } = useStopAgentTerminal(chatId, terminal.id);
  return (
    <>
      <button
        type="button"
        className="icon-btn run-cmd-dock"
        aria-label="Open in terminal"
        title="Open in terminal"
        onClick={() => openAgentTab(chatId, terminal.id)}
      >
        <TerminalIcon />
      </button>
      {agentTerminalLive(terminal.state) && (
        <button type="button" className="btn sm agent-term-stop" disabled={stopping} onClick={stop}>
          {stopping ? 'Stopping…' : 'Stop'}
        </button>
      )}
      {error && (
        <p className="agent-term-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function sameRow(before: { terminal: AgentTerminalView }, after: { terminal: AgentTerminalView }) {
  const [was, now] = [before.terminal, after.terminal];
  return (
    was.id === now.id &&
    was.state === now.state &&
    was.exitCode === now.exitCode &&
    was.stoppedBy === now.stoppedBy &&
    was.endedAt === now.endedAt
  );
}

export const AgentTerminalRow = memo(function AgentTerminalRow({
  terminal,
}: {
  terminal: AgentTerminalView;
}) {
  const dockChatId = use(CommandDockContext);
  const live = agentTerminalLive(terminal.state);
  const now = useNow(live);
  return (
    <section
      className={`run-cmd agent-term ${terminal.state}`}
      aria-label={`Agent terminal: ${terminal.command}`}
      data-agent-terminal={terminal.id}
    >
      <div className="run-cmd-head agent-term-head">
        <div className="agent-term-line" title={terminal.command}>
          <Mark terminal={terminal} />
          <code className="run-cmd-line">{terminal.command}</code>
          <span className="agent-term-chip">Agent terminal</span>
          <span className="run-cmd-state">{agentTerminalRowState(terminal, now)}</span>
        </div>
        {dockChatId && <RowControls chatId={dockChatId} terminal={terminal} />}
      </div>
      <span className="sr-only" role="status">
        {agentTerminalSpoken(terminal)}
      </span>
    </section>
  );
}, sameRow);

export function AgentTerminalsRunning({ terminals }: { terminals: readonly AgentTerminalView[] }) {
  const line = agentTerminalsRunningLine(terminals);
  return line ? <p className="ai-note agent-term-running">{line}.</p> : null;
}
