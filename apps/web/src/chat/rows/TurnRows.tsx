import { Fragment, useState, type ReactNode } from 'react';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import { AgentTerminalRow } from '../commands/AgentTerminalRow.tsx';
import { CommandUiContext, type CommandUiStore } from '../commands/command-ui.ts';
import { RowView, type RowContext } from './Rows.tsx';
import type { TurnRowPart } from './turn-rows.ts';

interface TurnRowsProps {
  parts: readonly TurnRowPart[];
  context: RowContext;
  children: (text: string, last: boolean) => ReactNode;
  steers?: (ids: readonly string[], index: number) => ReactNode;
}

export function TurnRows({ parts, context, children, steers }: TurnRowsProps) {
  const [commands] = useState<CommandUiStore>(() => new Map());
  return (
    <CommandUiContext value={commands}>
      <Parts parts={parts} context={context} {...(steers ? { steers } : {})}>
        {children}
      </Parts>
    </CommandUiContext>
  );
}

function Parts({ parts, context, children, steers }: TurnRowsProps) {
  const lastShown = parts.findLastIndex((part) => part.kind !== 'steers');
  return parts.map((part, index) => {
    if (part.kind === 'steers') {
      return <Fragment key={part.key}>{steers?.(part.ids, index)}</Fragment>;
    }
    if (part.kind === 'shots') return <BrowserShots key={part.key} shots={part.shots} />;
    if (part.kind === 'terminal') {
      return <AgentTerminalRow key={part.key} terminal={part.terminal} />;
    }
    if (part.kind === 'rows') {
      return (
        <div key={part.key} className="trows">
          {part.rows.map((row) => (
            <RowView key={row.key} row={row} context={context} />
          ))}
        </div>
      );
    }
    return <Fragment key={part.key}>{children(part.text, index === lastShown)}</Fragment>;
  });
}
