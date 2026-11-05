import { memo, useRef } from 'react';
import type { ConversationSummary } from '@spark-outpost/contracts';
import { MatchSnippet } from '../conversations/MatchSnippet.tsx';
import { isTerminalSession, lineText, noBreakParts, type LinePart } from './session-line.ts';
import type { PaletteEntry } from './palette-model.ts';
import { useInView } from './use-in-view.ts';
import { useSessionLine } from './use-session-line.ts';

const ROW_PARTS: readonly LinePart[] = ['step', 'steps', 'subagents', 'cost'];

interface PaletteRowProps {
  id: string;
  entry: PaletteEntry;
  index: number;
  active: boolean;
  onPick: (chat: ConversationSummary) => void;
  onHover: (index: number) => void;
}

export const PaletteRow = memo(function PaletteRow({
  id,
  entry,
  index,
  active,
  onPick,
  onHover,
}: PaletteRowProps) {
  const ref = useRef<HTMLLIElement>(null);
  const text = lineText(useSessionLine(entry.chat, useInView(ref)), ROW_PARTS);
  const line = isTerminalSession(entry.chat) ? noBreakParts(text) : text;
  const where = [entry.place, entry.agent].filter(Boolean).join(' · ');
  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      className={active ? 'sp-row act' : 'sp-row'}
      data-tone={entry.state.tone}
      onClick={() => onPick(entry.chat)}
      onPointerMove={() => onHover(index)}
    >
      <span className="sp-dot" aria-hidden="true" />
      <span className="sp-main">
        <span className="sp-title">{entry.chat.title}</span>
        {entry.chat.match && <MatchSnippet match={entry.chat.match} />}
        <span className="sp-where">{where}</span>
      </span>
      <span className="sp-side">
        <span className="sp-state">{entry.label}</span>
        {line && <span className="sp-line">{line}</span>}
      </span>
    </li>
  );
});
