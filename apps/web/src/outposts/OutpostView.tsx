import './outposts.css';
import './outpost-cards.css';
import { useMemo, useState } from 'react';
import { threadItems, type OutpostDetail, type OutpostPost } from '@spark-outpost/contracts';
import { ApiError } from '../api/client.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { SidebarToggle } from '../conversations/sidebar-layout.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { PauseIcon, ResumeIcon } from '../ui/icons.tsx';
import { QueryWait } from '../ui/loading/QueryWait.tsx';
import { Skeleton } from '../ui/loading/Skeleton.tsx';
import { InstructionsSheet } from './InstructionsSheet.tsx';
import { OutpostFaces } from './MemberFace.tsx';
import { MemberStrip } from './MemberStrip.tsx';
import { OutpostComposer, type ComposerFill } from './OutpostComposer.tsx';
import { OutpostSheet } from './OutpostSheet.tsx';
import { OutpostTitleMenu } from './OutpostTitleMenu.tsx';
import { OverviewPane } from './OverviewPane.tsx';
import { OverviewToggle } from './OverviewToggle.tsx';
import { PostList } from './PostList.tsx';
import { SuggestedThreads } from './SuggestedThreads.tsx';
import { ThreadPane } from './ThreadPane.tsx';
import type { Answering, ComposerTarget } from './composer-target.ts';
import { chatActivity } from './chat-activity.ts';
import { chatsOnApproval, memberViews, membersLabel } from './member-view.ts';
import { outpostPulls } from './outpost-pulls.ts';
import { formOf, hasChanges, sheetChanges, type SheetForm } from './sheet-draft.ts';
import { requestsOf, threadCard, waitsOnYou } from './thread-cards.ts';
import { useOutpostChats } from './use-outpost-chats.ts';
import { useOutpostLayout, type PhoneView } from './use-outpost-layout.ts';
import {
  useAnswer,
  useCancel,
  useDeleteOutpost,
  useOutpost,
  usePause,
  usePost,
  useSaveInstructions,
  useSaveOutpost,
  useStartNow,
} from './use-outposts.ts';

interface OutpostViewProps {
  id: string;
  jumpTo?: string | null | undefined;
  onOpenChat: (conversationId: string) => void;
  onGone: () => void;
}

function answeringOf(
  posts: readonly OutpostPost[],
  postId: string | null,
  approvalChats: ReadonlySet<string>,
): Answering | null {
  const post = posts.find((candidate) => candidate.id === postId);
  if (!post || post.state !== 'needs_you' || !post.toConversationId) return null;
  if (approvalChats.has(post.toConversationId)) return null;
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

function storyTagsOf(detail: OutpostDetail): ReadonlyMap<string, string> {
  const tags = new Map<string, string>();
  for (const story of detail.stories) {
    for (const task of story.tasks) {
      if (task.openingPostId && story.title) tags.set(task.openingPostId, story.title);
    }
  }
  return tags;
}

interface LoadedProps extends OutpostViewProps {
  detail: OutpostDetail;
}

type Sheet = 'settings' | 'instructions' | null;

function Loaded({ id, detail, jumpTo, onOpenChat, onGone }: LoadedProps) {
  const { outpost, posts, stories } = detail;
  const { chats, projectNames } = useOutpostChats();
  const { remote } = useRemoteClient();
  const layout = useOutpostLayout();
  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [fill, setFill] = useState<ComposerFill | null>(null);
  const post = usePost(id);
  const answer = useAnswer(id);
  const cancel = useCancel(id);
  const startNow = useStartNow(id);
  const pause = usePause(id);
  const save = useSaveOutpost(id);
  const saveInstructions = useSaveInstructions(id);
  const remove = useDeleteOutpost(id);
  const items = useMemo(() => threadItems(posts), [posts]);
  const members = useMemo(
    () => memberViews(outpost.members, chats, projectNames),
    [outpost.members, chats, projectNames],
  );
  const approvalChats = useMemo(() => chatsOnApproval(chats), [chats]);
  const activity = useMemo(() => chatActivity(chats), [chats]);
  const pulls = useMemo(() => outpostPulls(posts, stories, chats), [posts, stories, chats]);
  const cards = useMemo(
    () =>
      requestsOf(items).map((request) =>
        threadCard(request, pulls, activity.get(request.toConversationId ?? '')),
      ),
    [items, pulls, activity],
  );
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.post.id, card])), [cards]);
  const storyTags = useMemo(() => storyTagsOf(detail), [detail]);
  const answering = answeringOf(posts, answeringId, approvalChats);
  const waiting = waitsOnYou(cards);
  const paused = outpost.pausedAt !== null;
  const problem = cancel.error?.message ?? startNow.error?.message ?? pause.error?.message ?? null;
  const thread = layout.threadId ? (cardsById.get(layout.threadId) ?? null) : null;

  const fillBox = (text: string) => {
    setAnsweringId(null);
    setFill((last) => ({ id: (last?.id ?? 0) + 1, text }));
    layout.showConversation();
  };

  const startAnswer = (postId: string) => {
    setAnsweringId(postId);
    layout.showConversation();
  };

  const send = async (target: ComposerTarget, text: string) => {
    if (target.action === 'answer' && answering) {
      await answer.mutateAsync({ conversationId: answering.conversationId, text: target.body });
      setAnsweringId(null);
      return;
    }
    await post.mutateAsync({ id: crypto.randomUUID(), text, to: target.to });
  };

  const saveEdit = async (form: SheetForm) => {
    const changes = sheetChanges(formOf(outpost), form);
    if (hasChanges(changes)) await save.mutateAsync(changes);
    setSheet(null);
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
        {remote ? (
          <p>Chats are added on your Mac.</p>
        ) : (
          <button type="button" className="btn line sm" onClick={() => setSheet('settings')}>
            Add chats
          </button>
        )}
      </div>
    ) : (
      <div className="empty op-empty">
        <h2>Nothing here yet</h2>
        <p>Use @ and a handle anywhere to ask a chat for work. Anything else is a note.</p>
      </div>
    );

  const conversation = (
    <section className="op-conversation" aria-label="Conversation">
      <PostList
        items={items}
        cards={cardsById}
        selectedId={layout.threadId}
        answeringId={answering?.postId ?? null}
        jumpTo={jumpTo ?? null}
        approvalChats={approvalChats}
        storyTags={storyTags}
        empty={empty}
        after={<SuggestedThreads outpostId={id} members={members} />}
        onOpenThread={layout.openThread}
        onAnswer={startAnswer}
        onCancel={(postId) => cancel.mutate(postId)}
        onStartNow={(postId) => startNow.mutate(postId)}
      />
      <OutpostComposer
        members={members}
        answering={answering}
        paused={paused}
        fill={fill}
        onCancelAnswer={() => setAnsweringId(null)}
        onSend={send}
      />
    </section>
  );

  const threadPane = thread && (
    <ThreadPane
      outpostId={id}
      card={thread}
      canSteer={!remote}
      answerable={!approvalChats.has(thread.post.toConversationId ?? '')}
      onBack={layout.backToOverview}
      onOpenChat={onOpenChat}
      onCancel={(postId) => cancel.mutate(postId)}
    />
  );

  const overview = (
    <OverviewPane
      tab={layout.tab}
      cards={cards}
      pulls={pulls}
      members={members}
      stories={stories}
      selectedId={layout.threadId}
      sections={layout.phone}
      onTab={layout.setTab}
      onOpenThread={layout.openThread}
      onOpenChat={onOpenChat}
      onFill={fillBox}
    />
  );

  let body;
  if (layout.phone) {
    body = threadPane ?? (layout.phoneView === 'overview' ? overview : conversation);
  } else {
    body = (
      <>
        {conversation}
        {threadPane ?? (layout.overviewOpen ? overview : null)}
      </>
    );
  }

  return (
    <OutpostFaces members={outpost.members}>
      <main className="main op" aria-label={`Outpost ${outpost.name}`}>
        <header className="head chat-head op-head">
          <SidebarToggle />
          <OutpostTitleMenu
            name={outpost.name}
            overviewOpen={layout.phone ? null : layout.overviewOpen}
            onRename={() => setSheet('settings')}
            onSettings={() => setSheet('settings')}
            onInstructions={() => setSheet('instructions')}
            onToggleOverview={layout.toggleOverview}
          />
          <MemberStrip members={members} onOpen={onOpenChat} />
          <span className="op-count">{membersLabel(members.length)}</span>
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
            {!layout.phone && (
              <OverviewToggle
                open={layout.overviewOpen && thread === null}
                waiting={waiting}
                onToggle={layout.toggleOverview}
              />
            )}
          </div>
        </header>
        {layout.phone && !thread && (
          <div className="op-phone-switch">
            <Segmented
              ariaLabel="Outpost view"
              value={layout.phoneView}
              options={[
                { id: 'conversation', label: 'Conversation' },
                {
                  id: 'overview',
                  label: waiting > 0 ? `Overview · ${waiting} waiting` : 'Overview',
                },
              ]}
              onChange={(view) => layout.setPhoneView(view as PhoneView)}
            />
          </div>
        )}
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
        <div className="op-body">{body}</div>
        {sheet === 'settings' && (
          <OutpostSheet
            initial={formOf(outpost)}
            joined={outpost.members}
            chats={chats}
            projectNames={projectNames}
            outpostId={id}
            canManage={!remote}
            onStart={saveEdit}
            onDelete={deleteOutpost}
            onClose={() => setSheet(null)}
          />
        )}
        {sheet === 'instructions' && (
          <InstructionsSheet
            initial={outpost.instructions}
            canEdit={!remote}
            onSave={(text) => saveInstructions.mutateAsync(text)}
            onClose={() => setSheet(null)}
          />
        )}
      </main>
    </OutpostFaces>
  );
}

export function OutpostView({ id, jumpTo, onOpenChat, onGone }: OutpostViewProps) {
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
  return (
    <Loaded id={id} detail={query.data} jumpTo={jumpTo} onOpenChat={onOpenChat} onGone={onGone} />
  );
}
