import type { CrewMember } from '@spark-outpost/contracts';
import { isTerminalRunStatus } from '@spark-outpost/contracts';
import { Markdown } from '../markdown/Markdown.tsx';
import { MessageActions } from '../message-actions/MessageActions.tsx';
import { useRunStream } from '../use-run-stream.ts';

interface SteerAnswerProps {
  member: CrewMember;
  conversationId: string;
}

export function steerAnswers(
  answers: readonly CrewMember[] | undefined,
  messageId: string,
): CrewMember[] {
  return (answers ?? []).filter((member) => member.answers === messageId);
}

export function SteerAnswer({ member, conversationId }: SteerAnswerProps) {
  const stream = useRunStream(member.runId, conversationId);
  const live = !isTerminalRunStatus(member.status);
  if (!stream.text) return null;
  return (
    <div className="msg ai" data-answers={member.answers}>
      <Markdown text={stream.text} streaming={live} />
      {!live && (
        <MessageActions
          text={stream.text}
          createdAt={member.finishedAt ?? member.startedAt ?? ''}
          copyLabel="Copy reply"
          side="assistant"
        />
      )}
    </div>
  );
}
