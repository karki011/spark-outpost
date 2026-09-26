import { failingChecks, type CheckBody, type ReviewVerdict } from '@spark-outpost/contracts';
import {
  checkFailureText,
  criticFollowUp,
  criticPrompt,
  type ChangedFile,
  type ReviewSubject,
} from './context.ts';
import { runMember } from './members.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import { publish, type MemberResult, type Session } from './session.ts';
import type { FlowEvent } from './transitions.ts';

export interface ReviewRequest {
  key: string;
  subject: ReviewSubject;
  files: readonly ChangedFile[];
  patch: string;
  checks: CheckBody | null;
}

export interface ReviewDone {
  key: string;
  subject: ReviewSubject;
  result: MemberResult;
  verdict: ReviewVerdict;
  findings: string[];
}

export function checkLines(body: CheckBody | null): string[] {
  if (!body) return [];
  const lines = body.results.map((result) => {
    const status =
      result.outcome === 'passed'
        ? 'passed'
        : result.outcome === 'failed'
          ? `failed (exit ${result.exitCode ?? '?'})`
          : result.outcome.replace('_', ' ');
    return `- \`${result.command}\` ${status}`;
  });
  const failing = failingChecks(body);
  if (failing.length > 0) lines.push('', checkFailureText(failing));
  return lines;
}

export function combinedVerdict(verdicts: readonly ReviewVerdict[]): ReviewVerdict {
  if (verdicts.includes('concerns')) return 'concerns';
  if (verdicts.length === 0 || verdicts.includes('unclear')) return 'unclear';
  return 'looks_good';
}

export function combinedFindings(done: readonly ReviewDone[]): string[] {
  const concerned = done.filter((review) => review.verdict === 'concerns');
  if (concerned.length <= 1) return concerned.flatMap((review) => review.findings);
  return concerned.flatMap((review) =>
    review.findings.map((finding) => `${review.subject.name}: ${finding}`),
  );
}

export class ReviewQueue {
  private chain: Promise<void> = Promise.resolve();
  private readonly done = new Map<string, ReviewDone | null>();
  private readonly order: string[] = [];
  private started = 0;

  constructor(private readonly s: Session) {}

  get size(): number {
    return this.order.length;
  }

  enqueue(request: ReviewRequest): void {
    if (!this.order.includes(request.key)) this.order.push(request.key);
    const job = this.chain.then(() => this.review(request));
    this.chain = job.then(
      (review) => {
        this.done.set(request.key, review);
      },
      () => {
        this.done.set(request.key, null);
      },
    );
  }

  private async review(request: ReviewRequest): Promise<ReviewDone | null> {
    if (this.s.control.signal.aborted) return null;
    this.started += 1;
    const context = {
      changes: request.files,
      patch: request.patch,
      checks: checkLines(request.checks),
      subject: request.subject,
    };
    const prompt = criticPrompt({
      request: this.s.input.userRequest,
      plan: this.s.flow.steps.filter(Boolean),
      ...context,
    });
    const outcome = await runMember(
      this.s,
      { role: 'critic', stepIndex: 0, escalate: false, note: null, reason: 'first' },
      null,
      { record: false, prompt, followUp: criticFollowUp(context), attempt: this.started },
    );
    const review = outcome.review;
    if (!review) return null;
    return {
      key: request.key,
      subject: request.subject,
      result: outcome.result,
      verdict: review.verdict,
      findings: review.findings,
    };
  }

  async collect(): Promise<ReviewDone[]> {
    await this.chain;
    return this.order.flatMap((key) => {
      const review = this.done.get(key);
      return review ? [review] : [];
    });
  }
}

export async function collectedReview(s: Session): Promise<FlowEvent | null> {
  const done = (await s.reviews?.collect()) ?? [];
  if (s.control.reason() === 'cancelled') return { type: 'stopped' };
  if (done.length === 0) return null;
  s.results.push(...done.map((review) => review.result));
  s.findings = combinedFindings(done);
  const outcomes = done.map((review) => review.result.outcome);
  if (outcomes.includes('lease_lost')) throw new LeaseLostError(s.lease);
  await publish(s);
  return {
    type: 'agent_done',
    role: 'critic',
    outcome: outcomes.every((outcome) => outcome === 'failed') ? 'failed' : 'succeeded',
    error: done.at(-1)?.result.error ?? null,
    verdict: combinedVerdict(done.map((review) => review.verdict)),
  };
}
