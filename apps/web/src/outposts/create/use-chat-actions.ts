import { useState } from 'react';
import type { Attachment } from '@spark-outpost/contracts';
import type { ChatFormActions } from './ChatForm.tsx';
import {
  emptyChat,
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
import { isFinished } from './create-problems.ts';
import type { CreateData } from './use-create-data.ts';

export type DraftChange = (draft: CreateDraft) => CreateDraft;

export interface ChatActions extends ChatFormActions {
  onFiles: (files: Attachment[], pending: boolean) => void;
  onEdit: () => void;
}

export function useChatActions(
  data: CreateData,
  onChange: (change: DraftChange) => void,
  afterChange: () => void,
) {
  const [opened, setOpened] = useState<string | null>(null);
  const finished = (chat: ChatDraft, current: CreateDraft) => isFinished(chat, current, data.chats);

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

  const actionsFor = (key: string): ChatActions => ({
    onKind: (kind) => onChange((current) => withKind(current, key, kind)),
    onPick: (chatId) => {
      const picked = data.chats.find((candidate) => candidate.id === chatId);
      if (!picked) return;
      onChange((current) => withExistingChat(current, key, picked, data.projectNames));
      afterChange();
    },
    onProject: (projectId) => {
      const project = data.projects.find((candidate) => candidate.id === projectId);
      if (project) onChange((current) => withProject(current, key, project));
    },
    onAddedProject: (project) => onChange((current) => withProject(current, key, project)),
    onPatch: (changes) => onChange((current) => patchChat(current, key, changes)),
    onHandle: (typed) => onChange((current) => withHandle(current, key, typed)),
    onFiles: (files, pending) => onChange((current) => withFiles(current, key, files, pending)),
    onEdit: () => {
      setOpened(key);
      onChange((current) => patchChat(current, key, { open: true }));
    },
    onDone: () => {
      onChange((current) => patchChat(current, key, { open: false, added: true }));
      afterChange();
    },
    onRemove: () => {
      onChange((current) => withoutChat(current, key));
      afterChange();
    },
  });

  return { opened, addAnother, actionsFor, finished };
}
