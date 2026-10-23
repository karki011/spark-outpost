import { Fragment, type ReactNode } from 'react';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import { AgentTerminalRow } from '../commands/AgentTerminalRow.tsx';
import { RowView, type RowContext } from './Rows.tsx';
import type { TurnRowPart } from './turn-rows.ts';

interface TurnRowsProps {
  parts: readonly TurnRowPart[];
  context: RowContext;
  children: (text: string, last: boolean) => ReactNode;
}

export function TurnRows({ parts, context, children }: TurnRowsProps) {
  return parts.map((part, index) => {
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
    return <Fragment key={part.key}>{children(part.text, index === parts.length - 1)}</Fragment>;
  });
}
