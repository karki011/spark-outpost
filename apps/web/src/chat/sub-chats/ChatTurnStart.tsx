import { fromChatLine, type ConversationDetail, type Message } from '@spark-outpost/contracts';
import { useSubChats } from '../../tasks/use-sub-chats.ts';
import { SentBySpark } from '../automated/AutomatedTurn.tsx';
import { receivedLabel, turnStartAsk } from './ask-lines.ts';
import { ReportBlock } from './ReportBlock.tsx';
import { TaskCard } from './TaskCard.tsx';

interface SubChatTaskProps {
  detail: ConversationDetail;
  parentTitle: string;
  task: string;
}

function SubChatTask({ detail, parentTitle, task }: SubChatTaskProps) {
  const chat = detail.conversation;
  const rows = useSubChats(chat.parent?.id);
  return (
    <TaskCard
      parentTitle={parentTitle}
      task={task}
      row={rows.data?.find((row) => row.id === chat.id)}
      branch={chat.branch ?? null}
    />
  );
}

interface ChatTurnStartProps {
  detail: ConversationDetail;
  fromChat: string;
  message: Message;
  onOpenChat: (conversationId: string) => void;
}

export function ChatTurnStart({ detail, fromChat, message, onOpenChat }: ChatTurnStartProps) {
  const ask = turnStartAsk(detail.asks, detail.conversation.id, message.id);
  if (ask?.kind === 'task') {
    return <SubChatTask detail={detail} parentTitle={ask.from.title} task={message.content} />;
  }
  if (ask?.kind === 'report' && ask.report) {
    return <ReportBlock from={ask.from} report={ask.report} onOpenChat={onOpenChat} />;
  }
  const label = ask
    ? receivedLabel(ask, detail.asks ?? [])
    : `${fromChatLine(fromChat, message.content)} · not your message`;
  return <SentBySpark text={message.content} label={label} />;
}
