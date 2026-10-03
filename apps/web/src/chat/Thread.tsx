import './thread.css';
import { memo, useEffect } from 'react';
import { PERMISSION_DO, type ConversationDetail, type Project } from '@spark-outpost/contracts';
import { BlobScout } from '../brand/BlobScout.tsx';
import { useVoice } from '../spark/use-voice.ts';
import { greeting } from '../spark/voice.ts';
import { ArrowDownIcon } from '../ui/icons.tsx';
import { MessageAttachments } from './attachments/MessageAttachments.tsx';
import { AdviceLine } from './AdviceLine.tsx';
import { repoSummary } from './project/repo-list.ts';
import { RepoKit } from './project/RepoKit.tsx';
import { buildTurns } from './turns.ts';
import { CompactionDivider, ContinuedDivider } from './compaction/CompactionDivider.tsx';
import { compactionsByRun } from './compaction/compaction-text.ts';
import { SoloTurn } from './SoloTurn.tsx';
import { TodaySoFar } from './today/TodaySoFar.tsx';
import { useStickToBottom } from './use-stick-to-bottom.ts';
import { TaskCard } from '../tasks/TaskCard.tsx';
import { CrewTurn } from './crew/CrewTurn.tsx';
import { crewAgents } from '../crew/crew-projection.ts';
import { isCrewTurn } from '../crew/conversation-crew.ts';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { QuotedText } from './quotes/QuotedText.tsx';
import { QuoteMarks } from './quotes/QuoteMarks.tsx';
import { QuoteToolbar } from './quotes/QuoteToolbar.tsx';
import { PendingSends } from './send/PendingSends.tsx';
import type { ChatSends } from './send/use-chat-send.ts';
import type { QuotesState } from './quotes/use-quotes.ts';

interface ThreadProps {
  detail: ConversationDetail;
  repos: Project[];
  sends: ChatSends;
  onOpenTask?: (taskId: string) => void;
  onOpenChat: (conversationId: string) => void;
  quotes: QuotesState;
}

export const Thread = memo(function Thread({
  detail,
  repos,
  sends,
  onOpenTask,
  onOpenChat,
  quotes,
}: ThreadProps) {
  const voice = useVoice();
  const { scrollerRef, scroller, away, follow, jumpToLatest } = useStickToBottom();
  const turns = buildTurns(detail);
  const compactions = compactionsByRun(detail.compactions);
  const parentOf = new Map(detail.runs.map((run) => [run.id, run.parentRunId ?? run.id]));
  const taskAfterRun = new Map(
    detail.tasks.map((task) => {
      const last = task.runIds.at(-1);
      return [last ? (parentOf.get(last) ?? last) : undefined, task];
    }),
  );
  const crewRun = (runId: string) => {
    const orchestration = detail.orchestrations?.[runId] ?? null;
    return isCrewTurn(orchestration) ? orchestration : null;
  };
  const taskCard = (runId: string) => {
    const task = taskAfterRun.get(runId);
    if (!onOpenTask || !task) return null;
    const orchestration = crewRun(runId);
    const crew = orchestration ? crewAgents(orchestration, detail.activity) : [];
    return <TaskCard task={task} onOpen={() => onOpenTask(task.id)} agents={crew} />;
  };

  const pendingCount = sends.pending.length;
  useEffect(() => {
    if (pendingCount > 0) follow();
  }, [pendingCount, follow]);

  if (turns.length === 0 && pendingCount === 0) {
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
        <div className="col">
          {turns.map(({ run, userMessage, assistantMessage }) => (
            <section
              key={run.id}
              aria-label="Turn"
              data-assistant-message-id={assistantMessage?.id}
            >
              {compactions.get(run.id)?.map((compaction) => (
                <CompactionDivider
                  key={compaction.id}
                  compaction={compaction}
                  onOpenChat={onOpenChat}
                />
              ))}
              {userMessage && (
                <div className="msg me" data-message-id={userMessage.id}>
                  <MessageAttachments attachments={userMessage.attachments} />
                  {userMessage.content && (
                    <>
                      <div className="bubble">
                        <QuotedText text={userMessage.content} />
                      </div>
                      <MessageActions
                        text={userMessage.content}
                        createdAt={userMessage.createdAt}
                        copyLabel="Copy message"
                        side="user"
                      />
                    </>
                  )}
                </div>
              )}
              {crewRun(run.id) ? (
                <CrewTurn
                  run={run}
                  detail={detail}
                  orchestration={crewRun(run.id)!}
                  repo={repos[0] ?? null}
                  taskCard={taskCard(run.id)}
                />
              ) : (
                <SoloTurn
                  run={run}
                  detail={detail}
                  assistantMessage={assistantMessage}
                  repo={repos[0] ?? null}
                />
              )}
              {!crewRun(run.id) && (
                <>
                  <AdviceLine advice={detail.advice?.[run.id]} />
                  {taskCard(run.id)}
                </>
              )}
              {detail.continuedIn
                ?.filter((continuation) => continuation.runId === run.id)
                .map((continuation) => (
                  <ContinuedDivider
                    key={continuation.conversationId}
                    continuation={continuation}
                    onOpenChat={onOpenChat}
                  />
                ))}
            </section>
          ))}
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
