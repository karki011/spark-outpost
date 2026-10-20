import './thread.css';
import './turn-indent.css';
import { Fragment, memo, use, useEffect } from 'react';
import { PERMISSION_DO, type ConversationDetail, type Project } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { useVoice } from '../spark/use-voice.ts';
import { greeting } from '../spark/voice.ts';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { repoSummary } from './project/repo-list.ts';
import { RepoKit } from './project/RepoKit.tsx';
import { buildTurns } from './turns.ts';
import { TurnSection } from './TurnSection.tsx';
import { AssistantTopicDivider } from './compaction/DividerLine.tsx';
import { placeTopics } from './compaction/topic-model.ts';
import { TodaySoFar } from './today/TodaySoFar.tsx';
import { useStickToBottom } from './use-stick-to-bottom.ts';
import { useMessageJump } from './message-jump.ts';
import { QuoteMarks } from './quotes/QuoteMarks.tsx';
import { QuoteToolbar } from './quotes/QuoteToolbar.tsx';
import { PendingSends } from './send/PendingSends.tsx';
import type { ChatSends } from './send/use-chat-send.ts';
import type { QuotesState } from './quotes/use-quotes.ts';
import { FollowContext } from './follow-requests.ts';
import { OutlineTicks } from './outline/OutlineTicks.tsx';
import { RailContext } from './rail/rail-context.ts';
import { CommandDockContext } from './commands/command-dock.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { usePendingArrival } from './status/status-context.ts';
import { useRestoredAgentTabs } from '../terminal/dock/use-agent-tabs.ts';

function RailSlot() {
  const rail = use(RailContext);
  return rail ? <div className="crail-slot">{rail}</div> : null;
}

interface ThreadProps {
  detail: ConversationDetail;
  repos: Project[];
  sends: ChatSends;
  taskId: string | null;
  onOpenTask?: (taskId: string) => void;
  onOpenChat: (conversationId: string) => void;
  quotes: QuotesState;
}

export const Thread = memo(function Thread({
  detail,
  repos,
  sends,
  taskId,
  onOpenTask,
  onOpenChat,
  quotes,
}: ThreadProps) {
  const voice = useVoice();
  const { remote } = useRemoteClient();
  useRestoredAgentTabs(remote ? null : detail.conversation.id);
  const { scrollerRef, scroller, away, follow, release, jumpToLatest } = useStickToBottom();
  useMessageJump(detail.conversation.id, scroller, release, detail.messages.length);
  const turns = buildTurns(detail);
  const topics = placeTopics(
    detail.topics ?? [],
    turns.map(({ run, userMessage }) => ({
      runId: run.id,
      at: userMessage?.createdAt ?? run.createdAt,
    })),
  );
  const parentOf = new Map(detail.runs.map((run) => [run.id, run.parentRunId ?? run.id]));
  const taskAfterRun = new Map(
    detail.tasks.map((task) => {
      const last = task.runIds.at(-1);
      return [last ? (parentOf.get(last) ?? last) : undefined, task];
    }),
  );

  usePendingArrival(follow);

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
            <p className="empty-ask">What should we work on?</p>
            {repos.length > 0 ? (
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
            <TodaySoFar voice={voice} onOpenChat={onOpenChat} />
            {repos[0] && <RepoKit project={repos[0]} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="thread-wrap">
      <div className="thread" ref={scrollerRef}>
        <RailSlot />
        <div className="col">
          <OutlineTicks detail={detail} taskId={taskId} scroller={scroller} />
          <CommandDockContext value={remote ? null : detail.conversation.id}>
            {turns.map(({ run, userMessage, assistantMessage, laterMessages }) => (
              <Fragment key={run.id}>
                {topics.before.get(run.id)?.map((topic) => (
                  <AssistantTopicDivider key={topic.id} topic={topic} />
                ))}
                <TurnSection
                  run={run}
                  userMessage={userMessage}
                  assistantMessage={assistantMessage}
                  laterMessages={laterMessages}
                  detail={detail}
                  repo={repos[0] ?? null}
                  task={taskAfterRun.get(run.id) ?? null}
                  onOpenTask={onOpenTask}
                  onOpenChat={onOpenChat}
                />
              </Fragment>
            ))}
            {topics.after.map((topic) => (
              <AssistantTopicDivider key={topic.id} topic={topic} />
            ))}
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
