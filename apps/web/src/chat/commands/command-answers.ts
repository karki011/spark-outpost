import { ANSWERED_BY_ASK_SPARK, type Approval } from '@spark-outpost/contracts';
import { formatClock, type HourCycle } from '../../calendar/clock-format.ts';

export interface CommandAnswer {
  line: string;
  denied: boolean;
}

export type CommandAnswers = ReadonlyMap<string, CommandAnswer>;

function answered(approval: Approval): approval is Approval & { decidedAt: string } {
  return (
    approval.kind === 'execute' &&
    (approval.status === 'allowed' || approval.status === 'denied') &&
    approval.decidedBy === 'user' &&
    approval.decidedAt !== null
  );
}

function answeredHow(approval: Approval): string {
  const askSpark = approval.note === ANSWERED_BY_ASK_SPARK;
  if (approval.status === 'denied') return askSpark ? 'Ask Spark denied it' : 'You denied it';
  if (askSpark) return 'Ask Spark allowed it once';
  if (approval.scope === 'project') return 'You always allow it in this project';
  if (approval.scope === 'chat') return 'You allowed it for this chat';
  if (approval.scope === 'run') return 'You allowed it for this run';
  return 'You allowed it once';
}

export function commandAnswers(approvals: readonly Approval[], cycle: HourCycle): CommandAnswers {
  return new Map(
    approvals.filter(answered).map((approval) => [
      approval.toolCallId,
      {
        line: `${answeredHow(approval)} · ${formatClock(Date.parse(approval.decidedAt), cycle)}`,
        denied: approval.status === 'denied',
      },
    ]),
  );
}

export function cardsLeft(
  decided: readonly Approval[],
  answers: CommandAnswers,
  commandCalls: ReadonlySet<string>,
): Approval[] {
  return decided.filter(
    (approval) => !(answers.has(approval.toolCallId) && commandCalls.has(approval.toolCallId)),
  );
}
