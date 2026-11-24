import './thread.css';
import './turn-indent.css';
import { Fragment, memo, use, useEffect } from 'react';
import {
  PERMISSION_DO,
  archivedInactiveLine,
  type ConversationDetail,
  type Project,
} from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { useVoice } from '../spark/use-voice.ts';
import { greeting } from '../spark/voice.ts';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { repoSummary } from './project/repo-list.ts';
import { RepoKit } from './project/RepoKit.tsx';
import { buildTurns } from './turns.ts';
import { TurnSection } from './TurnSection.tsx';
import { AssistantTopicDivider, TopicDivider } from './compaction/DividerLine.tsx';
import { placeTopics } from './compaction/topic-model.ts';
import { TodaySoFar } from './today/TodaySoFar.tsx';
import { useStickToBottom } from './use-stick-to-bottom.ts';
import { useStableCallback } from '../ui/use-stable-callback.ts';
import { useChatPane } from './split/chat-pane.ts';
import { useMessageJump } from './message-jump.ts';
import { QuoteMarks } from './quotes/QuoteMarks.tsx';
import { QuoteToolbar } from './quotes/QuoteToolbar.tsx';
import { PendingSends } from './send/PendingSends.tsx';
import type { ChatSends } from './send/use-chat-send.ts';
import type { QuotesState } from './quotes/use-quotes.ts';
import { FollowContext } from './follow-requests.ts';
import { OutlineTicks } from './outline/OutlineTicks.tsx';
import { CommandDockContext } from './commands/command-dock.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { usePendingArrival } from './status/status-context.ts';
import { useRestoredAgentTabs } from '../terminal/dock/use-agent-tabs.ts';
import { useTurnWindow } from './turn-window/use-turn-window.ts';

interface ThreadProps {
  detail: ConversationDetail;
  repos: Project[];
  sends: ChatSends;
  taskId: string | null;
  onOpenChat: (conversationId: string) => void;
  quotes: QuotesState;
}

export const Thread = memo(function Thread({
  detail,
  repos,
  sends,
  taskId,
  onOpenChat,
  quotes,
}: ThreadProps) {
  const voice = useVoice();
  const { remote } = useRemoteClient();
  useRestoredAgentTabs(remote ? null : detail.conversation.id);
  const { scrollerRef, scroller, away, follow, release, jumpToLatest } = useStickToBottom();
  const turns = buildTurns(detail);
  const turnWindow = useTurnWindow(
    detail.conversation.id,
    turns.map((turn) => turn.run.id),
    scroller,
  );
  const revealMessage = useStableCallback((messageId: string) => {
    const turn = turns.find(
      ({ userMessage, assistantMessage, laterMessages }) =>
        userMessage?.id === messageId ||
        assistantMessage?.id === messageId ||
        laterMessages.some((message) => message.id === messageId),
    );
    const owners = turn ? [turn.run.id] : turns.map(({ run }) => run.id);
    if (owners.every((id) => turnWindow.mounted.has(id))) return true;
    turnWindow.reveal(owners);
    return false;
  });
  useMessageJump(
    detail.conversation.id,
    scroller,
    release,
    `${detail.messages.length}:${turnWindow.mounted.size}`,
    revealMessage,
  );
  const topics = placeTopics(
    detail.topics ?? [],
    turns.map(({ run, userMessage }) => ({
      runId: run.id,
      at: userMessage?.createdAt ?? run.createdAt,
    })),
  );

  usePendingArrival(follow);
  const intro = useChatPane().intro;

  const followRequests = use(FollowContext);
  useEffect(() => followRequests?.subscribe(follow), [followRequests, follow]);

  const pendingCount = sends.pending.length;
  useEffect(() => {
    if (pendingCount > 0) follow();
  }, [pendingCount, follow]);

  if (turns.length === 0 && pendingCount === 0 && topics.after.length === 0) {
    return (
      <div className="thread-wrap">
        <div className="thread">
          <div className="empty">
            <BlobScout size={64} />
            <h2>{greeting(voice, new Date().getHours())}</h2>
            {!intro && <p className="empty-ask">What should we work on?</p>}
            {intro ? (
              <p>{intro}</p>
            ) : repos.length > 0 ? (
              <p>
                New chat in <b>{repoSummary(repos.map((repo) => repo.name))}</b>.{' '}
                {detail.settings.permission === PERMISSION_DO ? (
                  <>Your AI can change files here, and asks first as your permissions say.</>
                ) : (
                  <>
                    Your AI can read {repos.length === 1 ? "this folder's" : "these folders'"} files
                    but won't change them.
                  </>
                )}
              </p>
            ) : (
              <p>
                Chats here have no project folder yet, so your AI can answer and explain but can't
                read or change files.
              </p>
            )}
            {!intro && <TodaySoFar voice={voice} onOpenChat={onOpenChat} />}
            {!intro && repos[0] && <RepoKit project={repos[0]} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-wrap">
      <div className="thread" ref={scrollerRef}>
        <div className="col">
          <OutlineTicks
            detail={detail}
            taskId={taskId}
            scroller={scroller}
            mountedTurns={turnWindow.mounted.size}
          />
          <CommandDockContext value={remote ? null : detail.conversation.id}>
            {turns.map(({ run, userMessage, assistantMessage, laterMessages }, index) => (
              <Fragment key={run.id}>
                {topics.before.get(run.id)?.map((topic) => (
                  <AssistantTopicDivider key={topic.id} topic={topic} />
                ))}
                <TurnSection
                  run={run}
                  userMessage={userMessage}
                  assistantMessage={assistantMessage}
                  laterMessages={laterMessages}
                  previous={turns[index - 1]?.run ?? null}
                  detail={detail}
                  repo={repos[0] ?? null}
                  onOpenChat={onOpenChat}
                  deferred={!turnWindow.mounted.has(run.id)}
                />
              </Fragment>
            ))}
            {topics.after.map((topic) => (
              <AssistantTopicDivider key={topic.id} topic={topic} />
            ))}
            {detail.conversation.archivedAt && detail.conversation.autoArchivedDays && (
              <TopicDivider label={archivedInactiveLine(detail.conversation.autoArchivedDays)} />
            )}
          </CommandDockContext>
          <PendingSends sends={sends} />
        </div>
      </div>
      <QuoteToolbar scrollerRef={scroller} quotes={quotes} />
      <QuoteMarks
        scrollerRef={scroller}
        conversationId={detail.conversation.id}
        pending={quotes.items}
      />
      <button type="button" className={away ? 'jump show' : 'jump'} onClick={jumpToLatest}>
        <ArrowDownIcon />
        Jump to latest
      </button>
    </div>
  );
});
