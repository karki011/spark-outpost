import { useEffect, useState } from 'react';
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
import { DraftGone } from './create/DraftGone.tsx';
import type { DraftChange } from './create/StepChats.tsx';
import { useCreateBase, useCreateData, type CreateBase } from './create/use-create-data.ts';
import { useDraftStart, type ReadyDraft } from './create/use-draft-start.ts';
import { startedThread } from './started-thread.ts';
import { useCreateOutpost } from './use-outposts.ts';

interface OutpostCreateProps {
  firstChatId?: string | null;
  draftId?: string | null;
  onCreated: (outpostId: string, threadId: string | null) => void;
  onClose: () => void;
}

interface CreateFlowProps {
  base: CreateBase;
  seed: () => CreateDraft;
  intoOutpostId: string | null;
  onCreated: (outpostId: string, threadId: string | null) => void;
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

function CreateFlow({ base, seed, intoOutpostId, onCreated, onClose }: CreateFlowProps) {
  const create = useCreateOutpost();
  const [outpostId] = useState(() => intoOutpostId ?? crypto.randomUUID());
  const [initial] = useState(seed);
  const [draft, setDraft] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [failed, setFailed] = useState<FailedMember[] | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const data = useCreateData(base, pickedChats(draft));

  const start = async () => {
    setFailure(null);
    try {
      const request = buildCreateRequest(outpostId, draft);
      const started = await create.mutateAsync(request);
      const opening = startedThread(started.stories, request.draftId);
      setThreadId(opening);
      if (started.failed.length === 0) onCreated(outpostId, opening);
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
      onOpenOutpost={() => onCreated(outpostId, threadId)}
      onClose={onClose}
    />
  );
}

interface DraftCreateProps {
  base: CreateBase | null;
  draftId: string;
  onCreated: (outpostId: string, threadId: string | null) => void;
  onClose: () => void;
}

function DraftCreate({ base, draftId, onCreated, onClose }: DraftCreateProps) {
  const start = useDraftStart(draftId, base);
  const [opened, setOpened] = useState<ReadyDraft | null>(null);
  if (opened === null && start.status === 'ready') setOpened(start);
  const startedIn = opened === null && start.status === 'started' ? start.outpostId : null;

  useEffect(() => {
    if (startedIn !== null) onCreated(startedIn, null);
  }, [startedIn, onCreated]);

  if (opened !== null && base !== null) {
    return (
      <CreateFlow
        base={base}
        seed={opened.seed}
        intoOutpostId={opened.outpostId}
        onCreated={onCreated}
        onClose={onClose}
      />
    );
  }
  if (start.status === 'gone') return <DraftGone message={start.message} onClose={onClose} />;
  return null;
}

export function OutpostCreate({ firstChatId, draftId, onCreated, onClose }: OutpostCreateProps) {
  const base = useCreateBase();
  if (draftId) {
    return <DraftCreate base={base} draftId={draftId} onCreated={onCreated} onClose={onClose} />;
  }
  if (!base) return null;
  return (
    <CreateFlow
      base={base}
      seed={() => initialDraft(base, firstChatId ?? null)}
      intoOutpostId={null}
      onCreated={onCreated}
      onClose={onClose}
    />
  );
}
