import './sub-chats.css';
import type { ChatAsk } from '@spark-outpost/contracts';
import { SentBySpark } from '../automated/AutomatedTurn.tsx';
import { turnAskLines, type AskLine } from './ask-lines.ts';
import { ReportBlock } from './ReportBlock.tsx';

interface LineProps {
  line: AskLine;
  from: ChatAsk['from'] | undefined;
  onOpenChat: (conversationId: string) => void;
}

function Line({ line, from, onOpenChat }: LineProps) {
  if (line.report && from) {
    return <ReportBlock from={from} report={line.report} onOpenChat={onOpenChat} />;
  }
  return (
    <div className="sc-ask" data-side={line.side}>
      <SentBySpark text={line.body} label={line.text} />
      {line.note && <p className="sc-ask-note">{line.note}</p>}
    </div>
  );
}

interface AskLinesProps {
  asks: readonly ChatAsk[] | undefined;
  chatId: string;
  runIds: readonly string[];
  onOpenChat: (conversationId: string) => void;
}

export function AskLines({ asks, chatId, runIds, onOpenChat }: AskLinesProps) {
  const groups = turnAskLines(asks, chatId, runIds);
  if (groups.length === 0) return null;
  const fromOf = (id: string) => asks?.find((ask) => ask.id === id)?.from;
  return (
    <div className="sc-asks">
      {groups.map((group) => {
        const lines = group.lines.map((line) => (
          <Line key={line.id} line={line} from={fromOf(line.id)} onOpenChat={onOpenChat} />
        ));
        return group.summary ? (
          <details key={group.key} className="sc-exchanges">
            <summary>{group.summary}</summary>
            <div className="sc-exchanges-b">{lines}</div>
          </details>
        ) : (
          <div key={group.key}>{lines}</div>
        );
      })}
    </div>
  );
}
