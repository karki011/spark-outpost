import { Fragment, useId, useState, type ReactNode } from 'react';
import { BrowserShots } from '../../browser/BrowserShots.tsx';
import { AgentTerminalRow } from '../commands/AgentTerminalRow.tsx';
import { CommandUiContext, type CommandUiStore } from '../commands/command-ui.ts';
import { StepToggle } from '../WorkLog.tsx';
import { BackgroundTerminals } from './BackgroundTerminals.tsx';
import { RowView, type RowContext } from './Rows.tsx';
import { foldedPart, foldLead, foldSummary } from './turn-fold.ts';
import type { TurnRowPart } from './turn-rows.ts';

export interface TurnFoldState {
  open: boolean;
  seconds: number | null;
  onToggle: () => void;
}

interface TurnRowsProps {
  parts: readonly TurnRowPart[];
  context: RowContext;
  children: (text: string, last: boolean) => ReactNode;
  steers?: (ids: readonly string[], index: number) => ReactNode;
  cards?: (ids: readonly string[]) => ReactNode;
  fold?: TurnFoldState | null;
}

interface PartsProps extends Omit<TurnRowsProps, 'fold'> {
  shown?: (index: number) => boolean;
}

export function TurnRows({ parts, context, children, steers, cards, fold = null }: TurnRowsProps) {
  const [commands] = useState<CommandUiStore>(() => new Map());
  const shared = {
    parts,
    context,
    children,
    ...(steers ? { steers } : {}),
    ...(cards ? { cards } : {}),
  };
  return (
    <CommandUiContext value={commands}>
      {fold ? (
        <>
          <FoldedWork {...shared} fold={fold} />
          <Parts {...shared} shown={(index) => !foldedPart(parts, index, fold.open)} />
        </>
      ) : (
        <Parts {...shared} />
      )}
    </CommandUiContext>
  );
}

function FoldedWork({ fold, ...shared }: PartsProps & { fold: TurnFoldState }) {
  const bodyId = useId();
  const summary = foldSummary(shared.parts);
  return (
    <div className={fold.open ? 'steps open turn-fold' : 'steps turn-fold'}>
      <StepToggle
        log={{ open: fold.open, listId: bodyId, toggle: fold.onToggle }}
        label={
          <>
            <b>{foldLead(fold.seconds)}</b>
            {summary && <span className="turn-fold-sum"> · {summary}</span>}
          </>
        }
      />
      <div id={bodyId} className="turn-fold-body" hidden={!fold.open}>
        {fold.open && (
          <Parts {...shared} shown={(index) => foldedPart(shared.parts, index, true)} />
        )}
      </div>
    </div>
  );
}

function Parts({ parts, context, children, steers, cards, shown = () => true }: PartsProps) {
  const lastShown = parts.findLastIndex((part) => part.kind !== 'steers' && part.kind !== 'cards');
  return parts.map((part, index) => {
    if (!shown(index)) return null;
    if (part.kind === 'steers') {
      return <Fragment key={part.key}>{steers?.(part.ids, index)}</Fragment>;
    }
    if (part.kind === 'cards') return <Fragment key={part.key}>{cards?.(part.ids)}</Fragment>;
    if (part.kind === 'shots') return <BrowserShots key={part.key} shots={part.shots} />;
    if (part.kind === 'terminal') {
      const [only] = part.terminals;
      if (part.terminals.length === 1 && only) {
        return <AgentTerminalRow key={part.key} terminal={only} />;
      }
      return <BackgroundTerminals key={part.key} terminals={part.terminals} />;
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
