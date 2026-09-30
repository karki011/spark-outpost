import type {
  Category,
  FeedbackPrompt,
  FeedbackRating,
  OutcomeKind,
  OutcomeReason,
  OutcomeSignal,
  OutcomeSignalKind,
  OutcomeVerdict,
} from '@spark-outpost/contracts';

const SIGNAL_WEIGHTS: Record<OutcomeSignalKind, number> = {
  kept: 1,
  checks_passed: 1,
  quiet_24h: 0.5,
  committed: 2,
  reverted: -2,
  correction: -1.5,
  re_ask: -1,
  checks_failed: -1,
  cancelled: -1,
  failed: -1.5,
  pr_merged: 2,
  pr_closed: -1,
  pr_reverted: -2,
  pr_review_comments: 0,
};

const SIGNAL_LABELS: Record<OutcomeSignalKind, string> = {
  kept: 'Kept the changes',
  checks_passed: 'Checks passed',
  quiet_24h: 'No fix or complaint within 24 hours',
  committed: 'The kept changes were committed',
  reverted: 'Reverted the changes',
  correction: 'A follow-up read as a correction',
  re_ask: 'The same request was asked again',
  checks_failed: 'Checks failed',
  cancelled: 'Cancelled',
  failed: 'The run failed',
  pr_merged: 'The pull request was merged',
  pr_closed: 'The pull request was closed unmerged',
  pr_reverted: 'The pull request was reverted',
  pr_review_comments: 'The pull request got review comments',
};

const FEEDBACK_WEIGHT = 3;

export function polarityOf(kind: OutcomeSignalKind): -1 | 0 | 1 {
  return Math.sign(SIGNAL_WEIGHTS[kind]) as -1 | 0 | 1;
}

type Scored = Pick<OutcomeSignal, 'kind'>;

export interface OutcomeScore {
  score: number | null;
  verdict: OutcomeVerdict;
  reasons: OutcomeReason[];
}

function polarities(signals: readonly Scored[]): Set<number> {
  return new Set(signals.map((signal) => polarityOf(signal.kind)).filter((sign) => sign !== 0));
}

export function scoreOutcome(
  signals: readonly Scored[],
  rating: FeedbackRating | null,
): OutcomeScore {
  const reasons: OutcomeReason[] = signals
    .filter((signal) => SIGNAL_WEIGHTS[signal.kind] !== 0)
    .map((signal) => ({ label: SIGNAL_LABELS[signal.kind], weight: SIGNAL_WEIGHTS[signal.kind] }));
  if (rating) {
    reasons.unshift({
      label: rating === 'up' ? 'You rated it good' : 'You rated it bad',
      weight: rating === 'up' ? FEEDBACK_WEIGHT : -FEEDBACK_WEIGHT,
    });
  }
  const total = reasons.reduce((sum, reason) => sum + Math.abs(reason.weight), 0);
  const score =
    total === 0 ? null : reasons.reduce((sum, reason) => sum + reason.weight, 0) / total;
  return { score, verdict: verdictOf(signals, rating), reasons };
}

function verdictOf(signals: readonly Scored[], rating: FeedbackRating | null): OutcomeVerdict {
  if (rating) return rating === 'up' ? 'good' : 'bad';
  const signs = polarities(signals);
  if (signs.size === 0) return 'unclear';
  if (signs.size > 1) return 'mixed';
  return signs.has(1) ? 'good' : 'bad';
}

export type Agreement = 'agree' | 'mixed' | 'unclear';

export function agreement(signals: readonly Scored[]): Agreement {
  const signs = polarities(signals);
  if (signs.size > 1) return 'mixed';
  const counted = signals.filter((signal) => polarityOf(signal.kind) !== 0).length;
  return counted >= 2 ? 'agree' : 'unclear';
}

export const FEEDBACK_SAMPLE_RATE = 0.2;
export const FEEDBACK_TURN_SPACING = 3;

export interface PromptInput {
  kind: OutcomeKind;
  succeeded: boolean;
  signals: readonly Scored[];
  askedInTask: boolean;
  turnNumber: number;
  askedRecently: boolean;
  roll: number;
  sampleRate: number;
}

export function feedbackPrompt(input: PromptInput): FeedbackPrompt | null {
  if (input.kind === 'other' || !input.succeeded || input.askedInTask) return null;
  if (input.turnNumber < FEEDBACK_TURN_SPACING || input.askedRecently) return null;
  if (agreement(input.signals) !== 'agree') return 'mixed';
  return input.roll < input.sampleRate ? 'sampled' : null;
}

const CORRECTION_PATTERNS: readonly RegExp[] = [
  /\b(that'?s|this is|it'?s|that is|it is) (wrong|not right|incorrect|broken|not it)\b/,
  /\bfix (it|this|that)\b/,
  /\b(didn'?t|doesn'?t|did not|does not|still doesn'?t|still does not|won'?t) (work|run|compile|build|pass)\b/,
  /\bstill (broken|failing|fails|wrong|not working|the same)\b/,
  /\bnot what i (asked|wanted|meant)\b/,
  /\byou (broke|missed|forgot|ignored)\b/,
  /\b(undo|revert|roll back) (it|this|that|your)\b/,
  /^(no|nope)\b[,.!]/,
];

export function correctionPattern(text: string): string | null {
  const normalized = text.toLowerCase().replaceAll('’', "'").trim();
  const match = CORRECTION_PATTERNS.find((pattern) => pattern.test(normalized));
  return match ? match.source : null;
}

const MIN_WORD_LENGTH = 3;
const MIN_WORDS = 3;
const RE_ASK_SIMILARITY = 0.6;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((word) => word.length >= MIN_WORD_LENGTH),
  );
}

export function requestSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size < MIN_WORDS || right.size < MIN_WORDS) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

const FIX_CATEGORIES: ReadonlySet<Category> = new Set(['bug_fix', 'debugging']);

export interface FollowUp {
  text: string;
  jevCategory: Category | null;
  sameChat: boolean;
}

export interface FollowUpContext {
  request: string;
  changedFiles: boolean;
}

export interface FollowUpSignal {
  kind: 'correction' | 're_ask';
  source: 'jev' | 'heuristic';
  detail: Record<string, unknown>;
}

export function classifyFollowUp(previous: FollowUpContext, next: FollowUp): FollowUpSignal | null {
  const similarity = requestSimilarity(previous.request, next.text);
  if (similarity >= RE_ASK_SIMILARITY) {
    return {
      kind: 're_ask',
      source: 'heuristic',
      detail: { similarity: Math.round(similarity * 100) / 100, sameChat: next.sameChat },
    };
  }
  if (!next.sameChat) return null;
  const pattern = correctionPattern(next.text);
  if (next.jevCategory && previous.changedFiles && FIX_CATEGORIES.has(next.jevCategory)) {
    return {
      kind: 'correction',
      source: 'jev',
      detail: { category: next.jevCategory, heuristic: pattern !== null },
    };
  }
  if (pattern) {
    return {
      kind: 'correction',
      source: 'heuristic',
      detail: { pattern, category: next.jevCategory },
    };
  }
  return null;
}
