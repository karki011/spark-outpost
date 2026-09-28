import type { CheckBody } from '@spark-outpost/contracts';
import {
  buildFindingQuestions,
  readFindings,
  type FindingReading,
} from '../advisor/finding-questions.ts';
import { FINDINGS_LIMIT } from './context.ts';
import { latestChecks } from './final-message.ts';
import { callJev } from './jev-calls.ts';
import { changesForReview } from './member-prompts.ts';
import { DIFFS_OFF, recordAdvice } from './observe.ts';
import { reviewAction, reviewLine, type ReviewAction } from './review-loop.ts';
import type { MemberResult, Session } from './session.ts';

const ACTION_TEXT: Record<ReviewAction, string> = {
  fix: 'fix turn',
  offer: 'offered on the keep card',
  clean: 'no fix turn',
  unclear: 'no fix turn',
  repeated: 'stop: the same findings came back',
  cap: 'stop: fix rounds used up',
};

export function findingSummary(
  review: number,
  readings: readonly FindingReading[],
  action: ReviewAction,
  diffsOff: boolean,
): string {
  const fixable = readings.filter((reading) => reading.correct).length;
  const byJev = readings.filter((reading) => reading.by === 'jev').length;
  const source = byJev === 0 ? 'rules' : byJev === readings.length ? 'jev' : 'jev and rules';
  const skipped = diffsOff ? `, Jev ${DIFFS_OFF}` : '';
  const total = `${readings.length} finding${readings.length === 1 ? '' : 's'}`;
  return `Review ${review}: correctness bugs ${fixable} of ${total} (${source}${skipped}) → ${ACTION_TEXT[action]}`;
}

export async function correctnessFindings(
  s: Session,
  critic: MemberResult,
  findings: readonly string[],
): Promise<string[]> {
  const shown = findings.slice(0, FINDINGS_LIMIT);
  if (shown.length === 0) return [];
  const diff = s.jevDiffs ? (await changesForReview(s)).patch : '';
  const call = s.jevDiffs
    ? await callJev(
        s.jev,
        () => buildFindingQuestions({ request: s.input.userRequest, diff, findings: shown }),
        s.control.signal,
      )
    : null;
  const readings = readFindings(shown, call?.status === 'answered' ? call.response : null);
  const fixable = readings.filter((reading) => reading.correct).map((reading) => reading.finding);
  const review = s.flow.review.rounds.length + 1;
  const action = reviewAction(s.flow.review, 'concerns', fixable, s.input.level);
  await recordAdvice(
    s,
    'finding',
    critic.runId,
    call,
    findingSummary(review, readings, action, !s.jevDiffs),
    {
      observation: false,
      review,
      fixRound: s.flow.review.fixRounds,
      findings: readings,
      fixable: fixable.length,
      action,
    },
    readings.some((reading) => reading.by === 'jev') ? 'jev' : 'rules',
  );
  return fixable;
}

export function checksPhrase(bodies: readonly CheckBody[]): string {
  const latest = latestChecks(bodies);
  if (latest.length === 0) return 'no project checks ran';
  if (latest.some((body) => body.status === 'failed')) return 'checks still fail';
  if (latest.every((body) => body.status === 'passed')) return 'checks pass';
  return 'checks were skipped';
}

export function sessionReviewLine(s: Session): string | null {
  return reviewLine(s.flow.review, checksPhrase(s.checkBodies));
}
