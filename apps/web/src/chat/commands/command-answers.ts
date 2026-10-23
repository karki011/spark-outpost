import { ANSWERED_BY_ASK_SPARK, type Approval } from '@spark-outpost/contracts';
import { formatClock, type HourCycle } from '../../calendar/clock-format.ts';

export type CommandAnswers = ReadonlyMap<string, string>;

function answered(approval: Approval): approval is Approval & { decidedAt: string } {
  return (
    approval.kind === 'execute' &&
    approval.status === 'allowed' &&
    approval.decidedBy === 'user' &&
    approval.decidedAt !== null
  );
}

function allowedHow(approval: Approval): string {
  if (approval.note === ANSWERED_BY_ASK_SPARK) return 'Ask Spark allowed it once';
  if (approval.scope === 'project') return 'You always allow it in this project';
  if (approval.scope === 'chat') return 'You allowed it for this chat';
  if (approval.scope === 'run') return 'You allowed it for this run';
  return 'You allowed it once';
}

export function commandAnswers(approvals: readonly Approval[], cycle: HourCycle): CommandAnswers {
  return new Map(
    approvals
      .filter(answered)
      .map((approval) => [
        approval.toolCallId,
        `${allowedHow(approval)} · ${formatClock(Date.parse(approval.decidedAt), cycle)}`,
      ]),
  );
}
