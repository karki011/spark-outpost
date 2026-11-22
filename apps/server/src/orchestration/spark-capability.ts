import type { InvolvementLevel, ModePosture, SparkOrigin } from '@spark-outpost/contracts';

export type SparkJobKind = 'mention' | 'step' | 'tool';
export type SparkCapability = 'read' | 'work' | 'sub_chat';

export interface SparkJobFacts {
  kind: SparkJobKind;
  reviewRun: boolean;
  beforePublish: boolean;
  testRun: boolean;
  hasProject: boolean;
  chatWorktree: boolean;
  isSubChat: boolean;
  origin: SparkOrigin;
  posture: ModePosture;
  level: InvolvementLevel | null;
  confirmed: boolean;
}

export interface SparkCapabilityDecision {
  capability: SparkCapability;
  reason: string;
}

const EDITING_POSTURES: ReadonlySet<ModePosture> = new Set([
  'asks',
  'edits',
  'auto',
  'full_access',
]);

export const CAPABILITY_REASONS = {
  review: 'Reviews only read.',
  beforePublish: 'A Before publish review only reads.',
  noProject: 'This chat has no project folder.',
  readOnlyMode: 'This Spark’s mode only reads.',
  unconfirmed: 'You have not confirmed this Spark’s mode yet.',
  notTyped: 'This job did not come from a message you typed on the Mac.',
  ownChat: 'This Spark is at Full auto → PR, so it works in its own sub-chat.',
  checkout: 'This chat works in your checkout, so the Spark only reads.',
  work: 'This Spark follows its own mode in the chat’s worktree. It cannot push or open a pull request.',
} as const;

function read(reason: string): SparkCapabilityDecision {
  return { capability: 'read', reason };
}

function ownsASubChat(facts: SparkJobFacts): boolean {
  if (facts.level !== 'full-auto') return false;
  if (facts.origin !== 'typed_mac' && facts.origin !== 'tool') return false;
  return !facts.isSubChat && !facts.testRun && facts.kind !== 'step';
}

export function sparkCapability(facts: SparkJobFacts): SparkCapabilityDecision {
  if (facts.reviewRun) return read(CAPABILITY_REASONS.review);
  if (facts.beforePublish) return read(CAPABILITY_REASONS.beforePublish);
  if (!facts.hasProject) return read(CAPABILITY_REASONS.noProject);
  if (!EDITING_POSTURES.has(facts.posture)) return read(CAPABILITY_REASONS.readOnlyMode);
  if (!facts.confirmed) return read(CAPABILITY_REASONS.unconfirmed);
  if (facts.origin === 'other') return read(CAPABILITY_REASONS.notTyped);
  if (ownsASubChat(facts)) return { capability: 'sub_chat', reason: CAPABILITY_REASONS.ownChat };
  if (!facts.chatWorktree) return read(CAPABILITY_REASONS.checkout);
  return { capability: 'work', reason: CAPABILITY_REASONS.work };
}
