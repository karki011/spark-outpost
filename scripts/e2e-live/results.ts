import type { Verification } from '../bench/verify.ts';
import type { TurnOutcome } from './api-driver.ts';
import type { TurnMetrics } from './collect.ts';
import type { Block, Cell, Driver, HarnessSetup } from './plan.ts';
import type { DepsSetup } from './repo.ts';
import type { ArmId } from './scenarios.ts';

export interface TurnRecord {
  prompt: string;
  metrics: TurnMetrics;
  outcome: TurnOutcome | null;
  autoDenied: number;
}

export interface CellRecord {
  key: string;
  block: Block;
  variant: string;
  scenario: string;
  arm: ArmId;
  repeat: number;
  driver: Driver | 'direct';
  setup: HarnessSetup | null;
  codexEffort: string | null;
  startedAt: string;
  repo: string;
  deps: DepsSetup | null;
  turns: TurnRecord[];
  verification: Verification;
  passed: boolean;
  asked: boolean;
  cleanup: string[] | null;
  costUsd: number;
  wallMs: number;
  activeMs: number;
  consoleErrors: string[];
  notes: TurnOutcome['notes'];
  error: string | null;
}

export interface E2eRun {
  version: 1;
  date: string;
  runtime: 'acp' | 'fake';
  budgetUsd: number;
  spentUsd: number;
  stoppedForBudget: boolean;
  settings: Record<string, string>;
  cells: CellRecord[];
}

export function cellCost(turns: readonly TurnRecord[]): number {
  return turns.reduce((sum, turn) => sum + turn.metrics.costUsd, 0);
}

export function projectedUsd(run: E2eRun, cell: Cell): number {
  const seen = run.cells.filter((record) => record.key === cell.key);
  if (seen.length === 0) return cell.expectUsd * 1.3;
  const worst = Math.max(...seen.map((record) => record.costUsd));
  return Math.max(worst, cell.expectUsd) * 1.15;
}
