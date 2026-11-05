import './create-chats.css';
import { PlusIcon } from '../../ui/icons.tsx';
import { listedChats, memberId, type CreateDraft } from './create-draft.ts';
import { chatView } from './create-labels.ts';
import { chatProblems } from './create-problems.ts';
import { ChatEntry } from './ChatEntry.tsx';
import { DraftCard } from './DraftCard.tsx';
import {
  afterChoices,
  isLead,
  orderParts,
  parentOf,
  pullLine,
  stackParent,
  unpushedParent,
  type PublishFacts,
} from './story-draft.ts';
import { useChatActions, type DraftChange } from './use-chat-actions.ts';
import type { CreateData } from './use-create-data.ts';

interface DraftChatsProps {
  draft: CreateDraft;
  data: CreateData;
  onChange: (change: DraftChange) => void;
  onSettled: () => void;
}

export function DraftChats({ draft, data, onChange, onSettled }: DraftChatsProps) {
  const { opened, addAnother, actionsFor, finished } = useChatActions(data, onChange, onSettled);
  const taken = new Set(listedChats(draft).flatMap((chat) => memberId(chat) ?? []));
  const untouched = draft.chats.some((chat) => !chat.touched);
  const facts: PublishFacts = {
    chats: data.chats,
    level: data.level,
    readsOnly: (chat) => data.agentOf(chat)?.risk === 'read',
  };

  return (
    <>
      <ul className="op-chat-list op-draft-list" aria-label="Chats to start">
        {draft.chats.map((chat, index) => {
          const view = chatView(chat, { ...data, agent: data.agentOf(chat) });
          const problems = chatProblems(chat, draft, data.chats);
          const actions = actionsFor(chat.key);
          return (
            <ChatEntry
              key={chat.key}
              chat={chat}
              number={index + 1}
              view={view}
              data={data}
              taken={taken}
              after={afterChoices(draft, chat)}
              stackedOn={stackParent(draft, chat, data.chats)?.handle ?? null}
              afterHandle={parentOf(draft, chat)?.handle ?? null}
              problems={problems}
              finished={finished(chat, draft)}
              focusOnMount={chat.key === opened}
              closed={
                <DraftCard
                  chat={chat}
                  view={view}
                  lead={isLead(draft, chat)}
                  order={orderParts(draft, chat, data.chats)}
                  pull={pullLine(draft, chat, facts)}
                  warning={unpushedParent(draft, chat, facts)}
                  problems={problems}
                  onHandle={actions.onHandle}
                  onEdit={actions.onEdit}
                  onRemove={actions.onRemove}
                />
              }
              {...actions}
            />
          );
        })}
      </ul>
      {!untouched && (
        <button type="button" className="btn sm ghost op-draft-add" onClick={addAnother}>
          <PlusIcon />
          Add a chat
        </button>
      )}
    </>
  );
}
