import './create-chats.css';
import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../../ui/icons.tsx';
import { listedChats, memberId, type CreateDraft } from './create-draft.ts';
import { chatView, summaryLine } from './create-labels.ts';
import { chatProblems } from './create-problems.ts';
import { startSummary } from './create-request.ts';
import { ChatEntry } from './ChatEntry.tsx';
import { afterChoices, parentOf, stackParent } from './story-draft.ts';
import { useChatActions, type DraftChange } from './use-chat-actions.ts';
import type { CreateData } from './use-create-data.ts';

interface StepChatsProps {
  draft: CreateDraft;
  data: CreateData;
  hidden: boolean;
  focusSignal: number;
  onChange: (change: DraftChange) => void;
}

export function StepChats({ draft, data, hidden, focusSignal, onChange }: StepChatsProps) {
  const stepRef = useRef<HTMLElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const [addFocus, setAddFocus] = useState(0);
  const { opened, addAnother, actionsFor, finished } = useChatActions(data, onChange, () =>
    setAddFocus((count) => count + 1),
  );
  const taken = new Set(listedChats(draft).flatMap((chat) => memberId(chat) ?? []));
  const untouched = draft.chats.some((chat) => !chat.touched);
  const summary = startSummary(draft);

  useEffect(() => {
    if (addFocus > 0) addRef.current?.focus();
  }, [addFocus]);

  useEffect(() => {
    if (focusSignal === 0) return;
    const target = stepRef.current?.querySelector<HTMLElement>(
      '.op-chat-form .choice-picker button',
    );
    (target ?? addRef.current)?.focus();
  }, [focusSignal]);

  return (
    <section ref={stepRef} className="op-step" hidden={hidden} aria-label="Chats">
      <h3 className="op-step-title">Chats</h3>
      <p className="op-step-lede">
        Each one gets a short handle used to address it. You can rename it later.
      </p>
      <ul className="op-chat-list">
        {draft.chats.map((chat, index) => (
          <ChatEntry
            key={chat.key}
            chat={chat}
            number={index + 1}
            view={chatView(chat, { ...data, agent: data.agentOf(chat) })}
            data={data}
            taken={taken}
            after={afterChoices(draft, chat)}
            stackedOn={stackParent(draft, chat, data.chats)?.handle ?? null}
            afterHandle={parentOf(draft, chat)?.handle ?? null}
            problems={chatProblems(chat, draft, data.chats)}
            finished={finished(chat, draft)}
            focusOnMount={chat.key === opened}
            {...actionsFor(chat.key)}
          />
        ))}
      </ul>
      <div className="op-chat-add">
        {!untouched && (
          <button ref={addRef} type="button" className="btn sm ghost" onClick={addAnother}>
            <PlusIcon />
            {draft.chats.length === 0 ? 'Add a chat' : 'Add another chat'}
          </button>
        )}
        {summary.chats > 0 && <span className="op-chat-summary">{summaryLine(summary)}</span>}
      </div>
    </section>
  );
}
