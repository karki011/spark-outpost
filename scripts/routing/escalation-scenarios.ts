import type { Ratings } from '../../packages/contracts/src/index.ts';

export interface EscalationScenario {
  id: string;
  title: string;
  repo: 'workbench' | 'spark';
  warmUp: readonly string[];
  contextTokens: number;
  followUp: string;
  ratings: Ratings;
  hidden: string;
  repairMinutes: number;
  repairWhy: string;
}

const rated = (value: number) => ({ value, confidence: 0.9 });

function ratings(complexity: number, stakes: number, contextDependence: number): Ratings {
  return {
    complexity: rated(complexity),
    stakes: rated(stakes),
    ambiguity: rated(2),
    contextDependence: rated(contextDependence),
  };
}

export const ESCALATION_SCENARIOS: readonly EscalationScenario[] = [
  {
    id: 'ledger-currencies-220k',
    title: 'Hard follow-up after a long ledger session',
    repo: 'workbench',
    warmUp: [
      'Parse the bank CSV export into ledger entries with integer cents.',
      'Group the entries by month and show the totals in the report.',
      'Read every file under src/ledger and explain how rounding flows through it.',
    ],
    contextTokens: 220_000,
    followUp:
      'Now make totals handle several currencies: convert with the rates table, keep cents exact, and keep the monthly report working.',
    ratings: ratings(4, 3, 3),
    hidden: 'ledger-currencies.test.ts',
    repairMinutes: 25,
    repairWhy: 'A wrong conversion hides in totals until someone reconciles by hand.',
  },
  {
    id: 'parser-regression-260k',
    title: 'Fix that depends on decisions made earlier in the session',
    repo: 'workbench',
    warmUp: [
      'Switch the date parser to the day-first format we agreed for EU exports.',
      'Keep the old US format behind the legacy flag, as discussed.',
      'Walk me through every caller of parseDate and what each expects.',
    ],
    contextTokens: 260_000,
    followUp:
      'The legacy flag broke month rollover for the formats we settled on above. Fix it without changing the decisions we made.',
    ratings: ratings(4, 3, 5),
    hidden: 'parse-date-rollover.test.ts',
    repairMinutes: 20,
    repairWhy: 'The fix must respect earlier decisions; losing them reintroduces the old bug.',
  },
  {
    id: 'migration-400k',
    title: 'High-stakes schema change deep into a session',
    repo: 'spark',
    warmUp: [
      'Explain how runs, tasks and run_artifacts relate.',
      'Add a read-only view listing artifacts per task.',
      'Trace every query that touches run_artifacts.',
    ],
    contextTokens: 400_000,
    followUp:
      'Add a migration that moves review findings into their own table, backfills them, and keeps the old reads working.',
    ratings: ratings(4, 4, 3),
    hidden: 'review-findings-migration.db.test.ts',
    repairMinutes: 45,
    repairWhy: 'A bad backfill needs a second migration and a data check on every install.',
  },
];
