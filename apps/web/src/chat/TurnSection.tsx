import { memo } from 'react';
import {
  type ConversationDetail,
  type Message,
  type Project,
  type Run,
} from '@spark-outpost/contracts';
import { isCrewTurn, isSparkLed, sparkMembers } from '../crew/conversation-crew.ts';
import { MessageAttachments } from './attachments/MessageAttachments.tsx';
import { CompactionDivider, ContinuedDivider } from './compaction/CompactionDivider.tsx';
import { compactionsByRun } from './compaction/compaction-text.ts';
import { CrewTurn } from './crew/CrewTurn.tsx';
import { SparkJobs, mainAgentRan } from './crew/SparkJobs.tsx';
import { SparkTag } from '../teammates/SparkCrewFace.tsx';
import { MessageActions } from './message-actions/MessageActions.tsx';
import { QuotedText } from './quotes/QuotedText.tsx';
import { turnAnchor } from './outline/outline-model.ts';
import { SoloTurn } from './SoloTurn.tsx';
import { TurnSteers } from './steer/SteeredMessage.tsx';
import { sameTurnDetail, turnRunIds } from './turn-props.ts';
import { OpenedPullRequests } from './pull-request/OpenedPullRequests.tsx';
import { PushNotices } from './pull-request/PushNotices.tsx';
import { InterruptedCard } from './interruption/InterruptedCard.tsx';
import { InterruptedNote } from './interruption/InterruptedNote.tsx';
import { RequestHeader, type RunOutpost } from './outpost/RequestHeader.tsx';
import { memberChatId, useOutpostSeam } from './outpost/outpost-seam.ts';
import { TurnOutpostLines } from './outpost/TurnOutpostLines.tsx';
import { OutpostFaces } from '../outposts/MemberFace.tsx';

interface TurnSectionProps {
  run: Run;
  userMessage: Message | null;
  assistantMessage: Message | null;
  laterMessages: readonly Message[];
  previous: Run | null;
  detail: ConversationDetail;
  repo: Project | null;
  onOpenChat: (conversationId: string) => void;
}

function OutpostRequest({ outpost, text }: { outpost: RunOutpost; text: string }) {
  const seam = useOutpostSeam();
  const open = seam ? () => seam.onOpenOutpost(outpost.outpostId, outpost.postId) : undefined;
  const outposts = seam?.outposts ?? [];
  const fromChatId = memberChatId(outposts, outpost.outpostId, outpost.fromHandle);
  const members = outposts.find((listed) => listed.id === outpost.outpostId)?.members;
  return (
    <OutpostFaces members={members}>
      <RequestHeader outpost={outpost} fromChatId={fromChatId} onOpen={open}>
        <QuotedText text={text} />
      </RequestHeader>
    </OutpostFaces>
  );
}

function sameMessages(before: readonly Message[], after: readonly Message[]): boolean {
  return (
    before.length === after.length && before.every((message, index) => message === after[index])
  );
}

function sameSection(before: TurnSectionProps, after: TurnSectionProps): boolean {
  return (
    before.run === after.run &&
    before.userMessage === after.userMessage &&
    before.assistantMessage === after.assistantMessage &&
    sameMessages(before.laterMessages, after.laterMessages) &&
    before.previous === after.previous &&
    before.repo === after.repo &&
    before.onOpenChat === after.onOpenChat &&
    sameTurnDetail(before.detail, after.detail, after.run)
  );
}

export const TurnSection = memo(function TurnSection({
  run,
  userMessage,
  assistantMessage,
  laterMessages,
  previous,
  detail,
  repo,
  onOpenChat,
}: TurnSectionProps) {
  const orchestration = detail.orchestrations?.[run.id] ?? null;
  const sparkLed = isSparkLed(orchestration) ? orchestration : null;
  const crew = !sparkLed && isCrewTurn(orchestration) ? orchestration : null;
  const handedTo = sparkMembers(orchestration);
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
              {run.outpost ? (
                <OutpostRequest outpost={run.outpost} text={userMessage.content} />
              ) : (
                <div className="bubble">
                  <QuotedText text={userMessage.content} />
                </div>
              )}
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
      {run.agentCycle && <p className="on-its-own">Continued on its own</p>}
      {sparkLed && <SparkJobs run={run} detail={detail} orchestration={sparkLed} repo={repo} />}
      {sparkLed && !mainAgentRan(sparkLed) ? null : crew ? (
        <CrewTurn run={run} detail={detail} orchestration={crew} repo={repo} />
      ) : (
        <SoloTurn
          run={run}
          detail={detail}
          assistantMessage={assistantMessage}
          laterMessages={laterMessages}
          previous={previous}
          repo={repo}
        />
      )}
      {!crew && <TurnSteers detail={detail} run={run} />}
      <TurnOutpostLines conversation={detail.conversation} run={run} />
      <OpenedPullRequests
        conversationId={detail.conversation.id}
        runIds={turnRunIds(detail, run.id)}
      />
      <PushNotices conversationId={detail.conversation.id} runIds={turnRunIds(detail, run.id)} />
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
