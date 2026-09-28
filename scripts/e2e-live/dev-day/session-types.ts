import type { BaseArm } from '../scenario-types.ts';
import type { LevelKey } from './levels.ts';

export type RepoKey = 'spark' | 'workbench' | 'external';

export type ActionKind = 'answer' | 'options' | 'plan' | 'build' | 'clarify';

export type Behavior =
  | 'noCrew'
  | 'planCard'
  | 'planLoaded'
  | 'criticRan'
  | 'checksRan'
  | 'topTier'
  | 'worktree'
  | 'cardFirst'
  | 'oneBuilder'
  | 'handoff'
  | 'resumed'
  | 'draftPr';

export interface Edit {
  file: string;
  from: string;
  to: string;
}

export interface Patch {
  files?: Record<string, string>;
  edits?: readonly Edit[];
}

export interface QuoteSpec {
  fromSession: string;
  pick: RegExp;
}

export interface DayTurn {
  text: string;
  fakeTags: string;
  quote?: QuoteSpec;
  interruptAfterMs?: { live: number; fake: number };
}

export interface Expectation {
  kind: ActionKind;
  answer?: readonly RegExp[];
  review?: readonly (readonly RegExp[])[];
  hidden?: string;
  allowed?: readonly string[];
}

export interface DaySession {
  id: string;
  title: string;
  why: string;
  repo: RepoKey;
  thread: string;
  level: LevelKey;
  freshSession?: boolean;
  directNewSession?: boolean;
  pastePlanFrom?: string;
  turns: readonly DayTurn[];
  expect: Expectation;
  behaviors: readonly Behavior[];
  policy?: 'balanced' | 'stop-on-clarify';
  savePlan?: boolean;
  plantBefore?: Patch;
  reference?: Patch;
  ship?: boolean;
  checks?: readonly string[];
  expectUsd: Record<BaseArm, number>;
  repairMinutes: number;
  repairWhy: string;
}
