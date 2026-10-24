import { useId, useState } from 'react';
import { agentTerminalLive } from '@spark-outpost/contracts';
import { ChevronIcon } from '../../ui/icons.tsx';
import { AgentTerminalRow } from '../commands/AgentTerminalRow.tsx';
import type { AgentTerminalView } from '../commands/agent-terminal-model.ts';
import { RowIcon } from './RowIcon.tsx';
import { Spinner } from './Rows.tsx';

export function backgroundLine(terminals: readonly AgentTerminalView[]): string {
  const running = terminals.filter((terminal) => agentTerminalLive(terminal.state)).length;
  const ended = terminals.length - running;
  const noun = (count: number) => (count === 1 ? 'background command' : 'background commands');
  if (running === 0) return `${ended} ${noun(ended)} completed`;
  if (ended === 0) return `${running} ${noun(running)} running`;
  return `${ended} ${noun(ended)} completed, ${running} running`;
}

export function BackgroundTerminals({ terminals }: { terminals: readonly AgentTerminalView[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const running = terminals.some((terminal) => agentTerminalLive(terminal.state));
  return (
    <div className="trows">
      <button
        type="button"
        className="trow trow-group"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <RowIcon name="run" />
        <span className="trow-text">
          <span className="trow-name">{backgroundLine(terminals)}</span>
        </span>
        <span className="trow-end">
          {running && <Spinner />}
          <ChevronIcon />
        </span>
      </button>
      <div className="trow-card" id={id} hidden={!open}>
        {open &&
          terminals.map((terminal) => <AgentTerminalRow key={terminal.id} terminal={terminal} />)}
      </div>
    </div>
  );
}
