import { useState } from 'react';
import { OutpostSheet } from './OutpostSheet.tsx';
import { EMPTY_FORM, withMember, type SheetForm } from './sheet-draft.ts';
import { useOutpostChats } from './use-outpost-chats.ts';
import { useCreateOutpost } from './use-outposts.ts';

interface OutpostCreateProps {
  firstChatId?: string | null;
  onCreated: (outpostId: string) => void;
  onClose: () => void;
}

export function OutpostCreate({ firstChatId = null, onCreated, onClose }: OutpostCreateProps) {
  const { chats, projectNames } = useOutpostChats();
  const create = useCreateOutpost();
  const [outpostId] = useState(() => crypto.randomUUID());
  const firstChat = chats.find((chat) => chat.id === firstChatId);
  const initial = firstChat ? withMember(EMPTY_FORM, firstChat, projectNames) : EMPTY_FORM;

  const start = async (form: SheetForm) => {
    await create.mutateAsync({ id: outpostId, name: form.name, members: form.members });
    onCreated(outpostId);
  };

  return (
    <OutpostSheet
      mode="create"
      initial={initial}
      chats={chats}
      projectNames={projectNames}
      onStart={start}
      onClose={onClose}
    />
  );
}
