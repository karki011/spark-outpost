import { useState } from 'react';
import type { FailedMember } from '@spark-outpost/contracts';
import { CreateSheet } from './create/CreateSheet.tsx';
import {
  emptyChat,
  listedChats,
  withChat,
  withExistingChat,
  type CreateDraft,
} from './create/create-draft.ts';
import { buildCreateRequest } from './create/create-request.ts';
import type { DraftChange } from './create/StepChats.tsx';
import { useCreateBase, useCreateData, type CreateBase } from './create/use-create-data.ts';
import { useCreateOutpost } from './use-outposts.ts';

interface OutpostCreateProps {
  firstChatId?: string | null;
  onCreated: (outpostId: string) => void;
  onClose: () => void;
}

const START_FAILED = 'The outpost could not be started. Try again.';

function initialDraft(base: CreateBase, firstChatId: string | null): CreateDraft {
  const first = emptyChat(base.defaults);
  const draft = withChat({ name: '', chats: [] }, first);
  const chat = base.chats.find((candidate) => candidate.id === firstChatId);
  return chat ? withExistingChat(draft, first.key, chat, base.projectNames) : draft;
}

function pickedChats(draft: CreateDraft): string[] {
  return listedChats(draft).flatMap((chat) =>
    chat.kind === 'existing' && chat.chatId ? [chat.chatId] : [],
  );
}

function CreateFlow({
  base,
  firstChatId,
  onCreated,
  onClose,
}: OutpostCreateProps & { base: CreateBase }) {
  const create = useCreateOutpost();
  const [outpostId] = useState(() => crypto.randomUUID());
  const [initial] = useState(() => initialDraft(base, firstChatId ?? null));
  const [draft, setDraft] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedMember[] | null>(null);
  const data = useCreateData(base, pickedChats(draft));

  const start = async () => {
    setFailure(null);
    try {
      const started = await create.mutateAsync(buildCreateRequest(outpostId, draft));
      if (started.failed.length === 0) onCreated(outpostId);
      else setFailed(started.failed);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : START_FAILED);
    }
  };

  return (
    <CreateSheet
      initial={initial}
      draft={draft}
      data={data}
      starting={create.isPending}
      failure={failure}
      failed={failed}
      onChange={(change: DraftChange) => setDraft(change)}
      onStart={() => void start()}
      onOpenOutpost={() => onCreated(outpostId)}
      onClose={onClose}
    />
  );
}

export function OutpostCreate(props: OutpostCreateProps) {
  const base = useCreateBase();
  return base ? <CreateFlow {...props} base={base} /> : null;
}
