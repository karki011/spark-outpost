import './create-chats.css';
import { useEffect, useRef, useState } from 'react';
import { PlusIcon } from '../../ui/icons.tsx';
import {
  emptyChat,
  listedChats,
  memberId,
  patchChat,
  settled,
  withChat,
  withExistingChat,
  withFiles,
  withHandle,
  withKind,
  withoutChat,
  withProject,
  type ChatDraft,
  type CreateDraft,
} from './create-draft.ts';
import { chatView, summaryLine } from './create-labels.ts';
import { chatProblems, isFinished } from './create-problems.ts';
import { startSummary } from './create-request.ts';
import { ChatEntry } from './ChatEntry.tsx';
import { afterChoices, parentOf, stackParent } from './story-draft.ts';
import type { CreateData } from './use-create-data.ts';

export type DraftChange = (draft: CreateDraft) => CreateDraft;

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
  const [opened, setOpened] = useState<string | null>(null);
  const taken = new Set(listedChats(draft).flatMap((chat) => memberId(chat) ?? []));
  const untouched = draft.chats.some((chat) => !chat.touched);
  const summary = startSummary(draft);
  const finished = (chat: ChatDraft, current: CreateDraft) => isFinished(chat, current, data.chats);

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

  const focusAdd = () => setAddFocus((count) => count + 1);

  const addAnother = () => {
    const added = emptyChat(data.defaults);
    setOpened(added.key);
    onChange((current) =>
      withChat(
        settled(current, (chat) => finished(chat, current)),
        added,
      ),
    );
  };

  const pick = (key: string, chatId: string) => {
    const picked = data.chats.find((candidate) => candidate.id === chatId);
    if (!picked) return;
    onChange((current) => withExistingChat(current, key, picked, data.projectNames));
    focusAdd();
  };

  const chooseProject = (key: string, projectId: string) => {
    const project = data.projects.find((candidate) => candidate.id === projectId);
    if (project) onChange((current) => withProject(current, key, project));
  };

  const remove = (key: string) => {
    onChange((current) => withoutChat(current, key));
    focusAdd();
  };

  const done = (key: string) => {
    onChange((current) => patchChat(current, key, { open: false, added: true }));
    focusAdd();
  };

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
            onKind={(kind) => onChange((current) => withKind(current, chat.key, kind))}
            onPick={(chatId) => pick(chat.key, chatId)}
            onProject={(projectId) => chooseProject(chat.key, projectId)}
            onAddedProject={(project) =>
              onChange((current) => withProject(current, chat.key, project))
            }
            onPatch={(changes) => onChange((current) => patchChat(current, chat.key, changes))}
            onHandle={(typed) => onChange((current) => withHandle(current, chat.key, typed))}
            onFiles={(files, pending) =>
              onChange((current) => withFiles(current, chat.key, files, pending))
            }
            onEdit={() => {
              setOpened(chat.key);
              onChange((current) => patchChat(current, chat.key, { open: true }));
            }}
            onDone={() => done(chat.key)}
            onRemove={() => remove(chat.key)}
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
