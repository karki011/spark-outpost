import type { TestCounts } from '../../bench/verify.ts';
import type { Rates } from '../dev-day/score.ts';
import type { StoryArmKey } from './arms.ts';
import type { StoryMetrics } from './metrics.ts';
import type { ProxyLine } from './proxy.ts';

export interface StoryAgent {
  role: string;
  name: string | null;
  provider: string;
  model: string | null;
  costUsd: number;
  status: string;
}

export interface StoryRecord {
  arm: StoryArmKey;
  rep: number;
  level: string;
  ship: boolean;
  startedAt: string;
  workPath: string;
  load?: [number, number];
  wallMs: number;
  costUsd: number;
  costByProvider: Record<string, number>;
  capUsd: number;
  cappedAtUsd: number | null;
  passed: boolean;
  failedChecks: string[];
  hidden: TestCounts | null;
  hiddenFailing: string[];
  suite: TestCounts | null;
  changed: string[];
  outside: string[];
  interventions: string[];
  clicks: number;
  userMinutes: number;
  error: string | null;
  timedOut: boolean;
  runIds: string[];
  agents: StoryAgent[];
  fullChecks: string[];
  critic: { verdict: string; findings: string[] }[];
  criticBeyondChecks: boolean | null;
  metrics: StoryMetrics | null;
  pr: { opened: boolean; draft: boolean; pieceTable: boolean; body: string } | null;
  proxy: ProxyLine[] | null;
  reply: string;
}

export interface StoryRun {
  version: 1;
  kind: 'story';
  date: string;
  runtime: 'acp' | 'fake';
  budgetUsd: number;
  spentUsd: number;
  stopped: string | null;
  rates: Rates;
  arms: StoryArmKey[];
  repeats: number;
  setup: Record<string, string>;
  records: StoryRecord[];
}
