import { memo, use, useState } from 'react';
import {
  isTerminalRunStatus,
  type ConversationDetail,
  type Message,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { isCrewTurn } from '../crew/conversation-crew.ts';
import { crewAgents } from '../crew/crew-projection.ts';
import { TaskCard, TaskCount } from '../tasks/TaskCard.tsx';
import { showsTaskCard } from '../tasks/task-card-shown.ts';
import { MessageAttachments } from './attachments/MessageAttachments.tsx';
import { CompactionDivider, ContinuedDivider } from './compaction/CompactionDivider.tsx';
import { compactionsByRun } from './compaction/compaction-text.ts';
import { CrewTurn } from './crew/CrewTurn.tsx';
import { SparkJobs, isSparkLed, mainAgentRan, sparkMembers } from './crew/SparkJobs.tsx';
import { SparkTag } from '../teammates/SparkCrewFace.tsx';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { QuotedText } from './quotes/QuotedText.tsx';
import { turnAnchor } from './rail/outline-model.ts';
import { RailTaskContext } from './rail/rail-context.ts';
import { SoloTurn } from './SoloTurn.tsx';
import { sameTurnDetail } from './turn-props.ts';
import { InterruptedCard } from './interruption/InterruptedCard.tsx';
import { InterruptedNote } from './interruption/InterruptedNote.tsx';

type Task = ConversationDetail['tasks'][number];

interface TurnSectionProps {
  run: Run;
  userMessage: Message | null;
  assistantMessage: Message | null;
  detail: ConversationDetail;
  repo: Project | null;
  task: Task | null;
  onOpenTask?: ((taskId: string) => void) | undefined;
  onOpenChat: (conversationId: string) => void;
}

function sameSection(before: TurnSectionProps, after: TurnSectionProps): boolean {
  return (
    before.run === after.run &&
    before.userMessage === after.userMessage &&
    before.assistantMessage === after.assistantMessage &&
    before.repo === after.repo &&
    before.task === after.task &&
    before.onOpenTask === after.onOpenTask &&
    before.onOpenChat === after.onOpenChat &&
    sameTurnDetail(before.detail, after.detail, after.run)
  );
}

export const TurnSection = memo(function TurnSection({
  run,
  userMessage,
  assistantMessage,
  detail,
  repo,
  task,
  onOpenTask,
  onOpenChat,
}: TurnSectionProps) {
  const orchestration = detail.orchestrations?.[run.id] ?? null;
  const sparkLed = isSparkLed(orchestration) ? orchestration : null;
  const crew = !sparkLed && isCrewTurn(orchestration) ? orchestration : null;
  const [startedSolo] = useState(crew === null);
  const handedTo = sparkMembers(orchestration);
  const inRail = use(RailTaskContext) === task?.id;
  const shownTask = onOpenTask && task && !inRail && showsTaskCard(task) ? task : null;
  const live = !isTerminalRunStatus(run.status);
  const taskCount =
    shownTask && onOpenTask && live ? (
      <TaskCount task={shownTask} onOpen={() => onOpenTask(shownTask.id)} />
    ) : null;
  const taskCard =
    onOpenTask && task && !inRail ? (
      <TaskCard
        task={task}
        onOpen={() => onOpenTask(task.id)}
        agents={crew ? crewAgents(crew, detail.activity) : []}
      />
    ) : null;
  const compactions = compactionsByRun(detail.compactions).get(run.id) ?? [];
  return (
    <section
      id={turnAnchor(run.id)}
      data-turn={run.id}
      tabIndex={-1}
      aria-label="Turn"
      data-assistant-message-id={assistantMessage?.id}
    >
      {compactions.map((compaction) => (
        <CompactionDivider key={compaction.id} compaction={compaction} onOpenChat={onOpenChat} />
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
          {handedTo.length > 0 && (
            <p className="msg-sparks">
              Handed to
              {handedTo.map((member) => (
                <SparkTag
                  key={member.runId}
                  sparkId={member.spark?.id ?? ''}
                  name={member.name}
                  role={member.spark?.role ?? ''}
                />
              ))}
            </p>
          )}
        </div>
      )}
      {sparkLed && <SparkJobs run={run} detail={detail} orchestration={sparkLed} repo={repo} />}
      {sparkLed && !mainAgentRan(sparkLed) ? null : crew ? (
        <CrewTurn
          run={run}
          detail={detail}
          orchestration={crew}
          repo={repo}
          taskCard={taskCard}
          continued={startedSolo}
        />
      ) : (
        <>
          <SoloTurn
            run={run}
            detail={detail}
            assistantMessage={assistantMessage}
            repo={repo}
            taskCount={taskCount}
          />
          {shownTask && !live && taskCard}
        </>
      )}
      <InterruptedNote run={run} detail={detail} />
      {detail.interruption?.runId === run.id && (
        <InterruptedCard
          interruption={detail.interruption}
          conversationId={detail.conversation.id}
        />
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
  );
}, sameSection);
