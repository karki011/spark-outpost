import type { TextAnchor } from '../../../packages/contracts/src/index.ts';
import type { TurnMetrics } from '../collect.ts';
import type { BaseArm } from '../scenario-types.ts';
import type { DayRepo } from './repos.ts';
import type { Evidence } from './score.ts';
import type { DaySession } from './sessions.ts';

/** A quote the developer selected in an earlier reply (select-to-chat). */
export interface PreparedQuote {
  passage: string;
  messageId: string | null;
  anchor: TextAnchor;
}

/** A turn as the arm sends it: quotes composed in, fake tags added in the dry run. */
export interface PreparedTurn {
  text: string;
  quote: PreparedQuote | null;
  interruptAfterMs: number | null;
}

export interface TurnLog {
  prompt: string;
  metrics: TurnMetrics;
  interrupted: boolean;
}

/** What an arm hands back after a session; the runner adds the repo-side evidence. */
export type ArmSessionResult = Omit<
  Evidence,
  'arm' | 'changed' | 'hidden' | 'suite' | 'originalUntouched' | 'draftPr' | 'pushedBranches'
> & {
  logs: TurnLog[];
  replyMessageId: string | null;
  cappedAtUsd: number | null;
  shots: string[];
  conversation: string | null;
};

export interface ArmDay {
  readonly arm: BaseArm;
  run(
    session: DaySession,
    repo: DayRepo,
    turns: readonly PreparedTurn[],
    capUsd: number,
  ): Promise<ArmSessionResult>;
  close(): Promise<void>;
}

/** Evidence fields only the harness can observe, blank for the direct arms. */
export const NO_HARNESS_EVIDENCE = {
  clarifyCard: false,
  planCard: false,
  planSaved: null,
  roles: [],
  checksRan: 0,
  builderPlanLoaded: null,
  criticPlanLoaded: null,
  topTier: null,
  worktrees: 0,
  cardFirst: null,
  builders: 0,
  parallelBuilders: 0,
  handoff: null,
  resumed: null,
  shipAvailable: null,
  clicks: 0,
  shots: [],
} satisfies Partial<ArmSessionResult>;
