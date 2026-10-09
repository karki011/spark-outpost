import './outposts.css';
import { useMemo, useState } from 'react';
import { threadItems, type OutpostDetail, type OutpostPost } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { PauseIcon, PenIcon, ResumeIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { MemberStrip } from './MemberStrip.tsx';
import { OutpostComposer } from './OutpostComposer.tsx';
import { OutpostSheet } from './OutpostSheet.tsx';
import { PostList } from './PostList.tsx';
import type { Answering, ComposerTarget } from './composer-target.ts';
import { memberViews, membersLabel } from './member-view.ts';
import { formOf, hasChanges, sheetChanges, type SheetForm } from './sheet-draft.ts';
import { useOutpostChats } from './use-outpost-chats.ts';
import {
  useAnswer,
  useCancel,
  useDeleteOutpost,
  useOutpost,
  usePause,
  usePost,
  useSaveOutpost,
} from './use-outposts.ts';

interface OutpostViewProps {
  id: string;
  onOpenChat: (conversationId: string) => void;
  onGone: () => void;
}

function answeringOf(posts: readonly OutpostPost[], postId: string | null): Answering | null {
  const post = posts.find((candidate) => candidate.id === postId);
  if (!post || post.state !== 'needs_you' || !post.toConversationId) return null;
  return {
    postId: post.id,
    conversationId: post.toConversationId,
    handle: post.toHandle ?? 'chat',
  };
}

function isGone(error: Error | null): boolean {
  return error instanceof ApiError && error.status === 404;
}

function Gone({ onGone }: { onGone: () => void }) {
  return (
    <main className="main op" aria-label="Outpost">
      <div className="empty op-empty" role="status">
        <h2>This outpost was deleted</h2>
        <p>Its chats are still in the sidebar. A turn that was running finishes in its own chat.</p>
        <button type="button" className="btn line sm" onClick={onGone}>
          Back to chats
        </button>
      </div>
    </main>
  );
}

interface LoadedProps extends OutpostViewProps {
  detail: OutpostDetail;
}

function Loaded({ id, detail, onOpenChat, onGone }: LoadedProps) {
  const { outpost, posts } = detail;
  const { chats, projectNames } = useOutpostChats();
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const post = usePost(id);
  const answer = useAnswer(id);
  const cancel = useCancel(id);
  const pause = usePause(id);
  const save = useSaveOutpost(id);
  const remove = useDeleteOutpost(id);
  const items = useMemo(() => threadItems(posts), [posts]);
  const members = useMemo(
    () => memberViews(outpost.members, chats, projectNames),
    [outpost.members, chats, projectNames],
  );
  const answering = answeringOf(posts, answeringId);
  const paused = outpost.pausedAt !== null;
  const problem = cancel.error?.message ?? pause.error?.message ?? null;

  const send = async (target: ComposerTarget, text: string) => {
    if (target.action === 'answer' && answering) {
      await answer.mutateAsync({ conversationId: answering.conversationId, text: target.body });
      setAnsweringId(null);
      return;
    }
    await post.mutateAsync({ id: crypto.randomUUID(), text });
  };

  const saveEdit = async (form: SheetForm) => {
    const changes = sheetChanges(formOf(outpost), form);
    if (hasChanges(changes)) await save.mutateAsync(changes);
    setEditing(false);
  };

  const deleteOutpost = async () => {
    await remove.mutateAsync();
    onGone();
  };

  const empty =
    members.length === 0 ? (
      <div className="empty op-empty">
        <h2>No chats here yet</h2>
        <p>Add chats, then ask one for work with @ and its handle.</p>
        <button type="button" className="btn line sm" onClick={() => setEditing(true)}>
          Add chats
        </button>
      </div>
    ) : (
      <div className="empty op-empty">
        <h2>Nothing here yet</h2>
        <p>Start with @ and a handle to ask a chat for work. Anything else is a note.</p>
      </div>
    );

  return (
    <main className="main op" aria-label={`Outpost ${outpost.name}`}>
      <header className="head chat-head op-head">
        <SidebarToggle />
        <h1 className="chat-title">{outpost.name}</h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="Edit outpost"
          onClick={() => setEditing(true)}
        >
          <PenIcon />
        </button>
        <button type="button" className="op-count" onClick={() => setEditing(true)}>
          {membersLabel(members.length)}
          <span className="sr-only">, edit chats and handles</span>
        </button>
        <div className="head-r">
          <button
            type="button"
            className="btn sm line"
            aria-pressed={paused}
            onClick={() => pause.mutate(!paused)}
          >
            {paused ? <ResumeIcon /> : <PauseIcon />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </header>
      <MemberStrip members={members} onOpen={onOpenChat} />
      {paused && (
        <p className="op-banner" role="status">
          Paused. New requests wait until you resume. Turns that are already running finish.
        </p>
      )}
      {problem && (
        <p className="op-banner bad" role="alert">
          {problem}
        </p>
      )}
      <PostList
        items={items}
        answeringId={answering?.postId ?? null}
        empty={empty}
        onAnswer={(asked) => setAnsweringId(asked.id)}
        onCancel={(postId) => cancel.mutate(postId)}
        onOpenChat={onOpenChat}
      />
      <OutpostComposer
        members={members}
        answering={answering}
        paused={paused}
        onCancelAnswer={() => setAnsweringId(null)}
        onSend={send}
      />
      {editing && (
        <OutpostSheet
          mode="edit"
          initial={formOf(outpost)}
          chats={chats}
          projectNames={projectNames}
          outpostId={id}
          onStart={saveEdit}
          onDelete={deleteOutpost}
          onClose={() => setEditing(false)}
        />
      )}
    </main>
  );
}

export function OutpostView({ id, onOpenChat, onGone }: OutpostViewProps) {
  const query = useOutpost(id);
  if (isGone(query.error)) return <Gone onGone={onGone} />;
  if (!query.data) {
    return (
      <main className="main op" aria-label="Outpost" aria-busy="true">
        <QueryWait query={query} what="the outpost">
          <Skeleton label="Opening the outpost" shape="list" rows={5} className="op-skeleton" />
        </QueryWait>
      </main>
    );
  }
  return <Loaded id={id} detail={query.data} onOpenChat={onOpenChat} onGone={onGone} />;
}
