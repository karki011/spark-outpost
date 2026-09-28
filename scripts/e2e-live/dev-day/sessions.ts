import type { BaseArm } from '../scenario-types.ts';
import { DEFAULT_LEVEL, type LevelKey } from './levels.ts';

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

const VITEST_ANALYTICS =
  'node node_modules/vitest/vitest.mjs run --project unit apps/web/src/analytics';
const NODE_TESTS = 'node --test "test/**/*.test.ts"';

export const REPO_CHECKS: Record<RepoKey, readonly string[] | undefined> = {
  spark: [VITEST_ANALYTICS],
  workbench: [NODE_TESTS],
  external: undefined,
};

export const SPARK_BASELINE: Patch = {
  edits: [
    {
      file: 'apps/web/src/analytics/spend-summaries.ts',
      from: 'was reported by providers',
      to: 'was reportd by providers',
    },
    {
      file: 'apps/web/src/analytics/analytics-model.ts',
      from: 'return `${Math.round((100 * part) / whole)}%`;',
      to: 'return `${Math.floor((100 * part) / whole)}%`;',
    },
  ],
};

export const SPARK_HIDDEN_PATHS = ['scripts/e2e-live/dev-day', 'docs/benchmarks/dev-day-PLAN.md'];

const CSV_SPEC = [
  'Plan adding CSV export to Analytics. On the Spend tab, an "Export CSV" button downloads the spend breakdown (one row per project, provider and model).',
  'Put the CSV itself in a pure function `spendCsv(data: AnalyticsSpend): string` in `apps/web/src/analytics/spend-csv.ts`: header `project,provider,model,runs,cost_usd,reported_usd,estimated_usd`, one row per spend leaf in the order given, dollar amounts with four decimals, fields quoted RFC 4180 style when they contain a comma, quote or newline, `\\n` line endings with a trailing newline.',
  "Plan only for now: don't change any files. I'll build it in a separate session.",
].join('\n\n');

const TAGS_STORY = [
  'Add tags to projects, end to end:',
  '- Database: a new migration that stores tags per project. Existing databases must upgrade and their projects start with no tags.',
  '- API: `PUT /projects/:id/tags` with `{ "tags": [...] }` replaces the project\'s tags and answers 200 `{ tags }`. Tags are trimmed, lowercased, de-duplicated and sorted; a blank or non-string tag is a 400, an unknown project a 404. `GET /projects` and `GET /projects/:id` include `tags: string[]` on every project.',
  '- UI: `renderProjectRow` shows each tag after the name as `<span class="tag">name</span>`, escaped.',
  'Add tests for each part.',
].join('\n');

export const SESSIONS: readonly DaySession[] = [
  {
    id: 's01',
    title: 'Question: how the code scan picks files',
    why: 'The cheapest crew answers from the code; nothing changes.',
    repo: 'spark',
    thread: 'scan',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: "How does the code scan decide which files to read and index? Which files does it skip, and where in the code is that decided? Just answer; don't change anything.",
        fakeTags: '',
      },
    ],
    expect: {
      kind: 'answer',
      answer: [/skip\.ts|skipReason|isSkipped/, /node_modules|lock ?file|binary|generated/i],
    },
    behaviors: ['noCrew'],
    expectUsd: { harness: 0.25, 'direct-claude': 0.2, 'direct-codex': 0.15 },
    repairMinutes: 5,
    repairWhy: 'read the code yourself or re-ask',
  },
  {
    id: 's02',
    title: 'Brainstorm: showing skipped files',
    why: 'Options with trade-offs, not a plan card and not edits.',
    repo: 'spark',
    thread: 'brainstorm',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: "I'd like people to see which files the code scan skipped and why. Brainstorm a few ways we could show that, with the trade-offs of each. Options only for now: no plan and no changes.",
        fakeTags: '',
      },
    ],
    expect: { kind: 'options' },
    behaviors: ['noCrew'],
    expectUsd: { harness: 0.25, 'direct-claude': 0.2, 'direct-codex': 0.15 },
    repairMinutes: 4,
    repairWhy: 'undo anything it started and re-ask for options',
  },
  {
    id: 's03',
    title: 'Plan only: CSV export for Analytics',
    why: 'A plan card; the approved plan is saved for a later session; no edits.',
    repo: 'spark',
    thread: 'csv',
    level: DEFAULT_LEVEL,
    savePlan: true,
    turns: [{ text: CSV_SPEC, fakeTags: ' #planmode' }],
    expect: { kind: 'plan' },
    behaviors: ['planCard'],
    expectUsd: { harness: 0.6, 'direct-claude': 0.35, 'direct-codex': 0.25 },
    repairMinutes: 8,
    repairWhy: 'revert early edits and write or re-request the plan',
  },
  {
    id: 's04',
    title: 'Build it from the plan in a new session',
    why: '"Do it" in a fresh session: the agreed plan is loaded, followed and checked by the Critic.',
    repo: 'spark',
    thread: 'csv',
    level: DEFAULT_LEVEL,
    freshSession: true,
    directNewSession: true,
    pastePlanFrom: 's03',
    turns: [{ text: 'Do it: build the CSV export we planned.', fakeTags: ' #build #crew' }],
    expect: {
      kind: 'build',
      hidden: 'devday-s04.test.ts',
      allowed: ['apps/web/src/analytics/**', 'apps/web/src/**/*.css', 'notes.txt'],
    },
    behaviors: ['planLoaded', 'criticRan'],
    reference: {
      files: {
        'apps/web/src/analytics/spend-csv.ts': 'reference/s04/apps/web/src/analytics/spend-csv.ts',
      },
      edits: [
        {
          file: 'apps/web/src/analytics/SpendTab.tsx',
          from: "} from './spend-summaries.ts';",
          to: "} from './spend-summaries.ts';\nimport { downloadSpendCsv } from './spend-csv.ts';",
        },
        {
          file: 'apps/web/src/analytics/SpendTab.tsx',
          from: '    <div className="an-grid">',
          to: '    <div className="an-grid">\n      <button type="button" className="btn" onClick={() => downloadSpendCsv(data)}>\n        Export CSV\n      </button>',
        },
      ],
    },
    checks: [VITEST_ANALYTICS],
    expectUsd: { harness: 1.2, 'direct-claude': 0.7, 'direct-codex': 0.5 },
    repairMinutes: 30,
    repairWhy: 'find where it strayed from the plan, fix the CSV and wire the button',
  },
  {
    id: 's05',
    title: 'One-line typo fix',
    why: 'A direct edit: no plan card, no Critic.',
    repo: 'spark',
    thread: 'typo',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: 'Typo on the Analytics Spend tab: the source line says "was reportd by providers". Fix it.',
        fakeTags: ' #build',
      },
    ],
    expect: {
      kind: 'build',
      hidden: 'devday-s05.test.ts',
      allowed: ['apps/web/src/analytics/spend-summaries.ts', 'notes.txt'],
    },
    behaviors: ['noCrew'],
    checks: [VITEST_ANALYTICS],
    reference: {
      edits: [
        {
          file: 'apps/web/src/analytics/spend-summaries.ts',
          from: 'was reportd by providers',
          to: 'was reported by providers',
        },
      ],
    },
    expectUsd: { harness: 0.1, 'direct-claude': 0.08, 'direct-codex': 0.06 },
    repairMinutes: 3,
    repairWhy: 'fix one word by hand',
  },
  {
    id: 's06',
    title: 'Small bug: percentages round down',
    why: 'Builder plus the project checks.',
    repo: 'spark',
    thread: 'bug',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: 'Bug: on Analytics a share of 2 out of 3 shows as 66%, but it should round to the nearest percent (67%). Fix it.',
        fakeTags: ' #build',
      },
    ],
    expect: {
      kind: 'build',
      hidden: 'devday-s06.test.ts',
      allowed: ['apps/web/src/analytics/**', 'notes.txt'],
    },
    behaviors: ['checksRan'],
    reference: {
      edits: [
        {
          file: 'apps/web/src/analytics/analytics-model.ts',
          from: 'return `${Math.floor((100 * part) / whole)}%`;',
          to: 'return `${Math.round((100 * part) / whole)}%`;',
        },
      ],
    },
    checks: [VITEST_ANALYTICS],
    expectUsd: { harness: 0.3, 'direct-claude': 0.2, 'direct-codex': 0.15 },
    repairMinutes: 10,
    repairWhy: 'find the rounding helper and fix it',
  },
  {
    id: 's07',
    title: 'Review my uncommitted changes',
    why: 'The review covers the edited old file and the new file; nothing changes.',
    repo: 'spark',
    thread: 'review',
    level: DEFAULT_LEVEL,
    plantBefore: {
      files: { 'apps/web/src/analytics/median.ts': 'plants/s07/apps/web/src/analytics/median.ts' },
      edits: [
        {
          file: 'apps/web/src/analytics/analytics-model.ts',
          from: '${count === 1 ? noun : many}',
          to: '${count <= 1 ? noun : many}',
        },
      ],
    },
    turns: [
      {
        text: "Review my uncommitted changes before I commit them. Don't change anything; just tell me what's wrong.",
        fakeTags: ' #crew',
      },
    ],
    expect: {
      kind: 'answer',
      review: [
        [/plural|singular/i, /\b0\b|zero|<= ?1|none/i],
        [/median/i, /sort|even/i],
      ],
    },
    behaviors: ['criticRan'],
    expectUsd: { harness: 0.4, 'direct-claude': 0.25, 'direct-codex': 0.2 },
    repairMinutes: 20,
    repairWhy: 'the bugs ship; find them later from a user report',
  },
  {
    id: 's08',
    title: 'Vague ask: "make it faster"',
    why: 'Ask what to speed up instead of guessing.',
    repo: 'spark',
    thread: 'vague',
    level: DEFAULT_LEVEL,
    policy: 'stop-on-clarify',
    turns: [{ text: 'Make it faster.', fakeTags: ' #build #vague' }],
    expect: { kind: 'clarify' },
    behaviors: [],
    expectUsd: { harness: 0.1, 'direct-claude': 0.3, 'direct-codex': 0.2 },
    repairMinutes: 15,
    repairWhy: 'review and revert a guessed optimisation',
  },
  {
    id: 's09',
    title: 'Ask about a quoted passage',
    why: 'Select-to-chat: quote blocks from the first answer, sent as the UI sends them.',
    repo: 'spark',
    thread: 'scan',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: 'Why are these skipped, and can a project opt one of them back in? Just answer.',
        fakeTags: '',
        quote: { fromSession: 's01', pick: /skip|lock|node_modules|binary|generated/i },
      },
    ],
    expect: {
      kind: 'answer',
      answer: [/skip\.ts|skipReason|isSkipped|SKIPPED_DIRECTORIES|LOCKFILES/],
    },
    behaviors: ['noCrew'],
    expectUsd: { harness: 0.15, 'direct-claude': 0.12, 'direct-codex': 0.1 },
    repairMinutes: 4,
    repairWhy: 're-ask with more context',
  },
  {
    id: 's10',
    title: 'Risky: migration renaming a column',
    why: 'Top tier, a worktree, and a card before anything destructive; old rows survive.',
    repo: 'workbench',
    thread: 'migration',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: "Rename the `amount` column on `expenses` to `amount_cents` (it has always held cents). People have existing databases full of data, so add a new migration that keeps every row, and update the code and tests. Keep the API's JSON field names as they are.",
        fakeTags: ' #build #crew',
      },
    ],
    expect: {
      kind: 'build',
      hidden: 'devday-s10.test.ts',
      allowed: ['migrations/**', 'src/**', 'test/**', 'README.md', 'notes.txt'],
    },
    behaviors: ['topTier', 'worktree', 'cardFirst'],
    reference: {
      files: {
        'migrations/003_expenses_amount_cents.sql':
          'reference/s10/migrations/003_expenses_amount_cents.sql',
        'src/projects.ts': 'reference/s10/src/projects.ts',
      },
    },
    checks: [NODE_TESTS],
    expectUsd: { harness: 1.0, 'direct-claude': 0.4, 'direct-codex': 0.3 },
    repairMinutes: 45,
    repairWhy: 'restore lost data from a backup and rewrite the migration',
  },
  {
    id: 's11',
    title: 'Story: tags on projects (DB + API + UI)',
    why: 'Builder-sized chunks, one Builder by default, context handoff at 75% if it triggers.',
    repo: 'workbench',
    thread: 'tags',
    level: DEFAULT_LEVEL,
    turns: [{ text: TAGS_STORY, fakeTags: ' #build #crew' }],
    expect: {
      kind: 'build',
      hidden: 'devday-s11.test.ts',
      allowed: ['migrations/**', 'src/**', 'test/**', 'README.md', 'notes.txt'],
    },
    behaviors: ['oneBuilder', 'handoff', 'criticRan'],
    reference: {
      files: {
        'migrations/004_project_tags.sql': 'reference/s11/migrations/004_project_tags.sql',
        'src/projects.ts': 'reference/s11/src/projects.ts',
        'src/api.ts': 'reference/s11/src/api.ts',
        'src/ui.ts': 'reference/s11/src/ui.ts',
      },
    },
    checks: [NODE_TESTS],
    expectUsd: { harness: 1.8, 'direct-claude': 0.9, 'direct-codex': 0.7 },
    repairMinutes: 60,
    repairWhy: 'finish the missing layer and its tests by hand',
  },
  {
    id: 's12',
    title: 'Full auto: small feature to a draft PR',
    why: 'Full auto builds and opens a draft PR on the local fake remote; nothing real is pushed.',
    repo: 'workbench',
    thread: 'ship',
    level: 'fullAuto',
    ship: true,
    turns: [
      {
        text: "Add `GET /projects/:id/expenses`: the project's expenses newest first (by created_at, then id), as `[{ id, projectId, amount, note, createdAt }]`, and a 404 for an unknown project. Add a test. Ship it as a draft PR when it's done.",
        fakeTags: ' #build',
      },
    ],
    expect: {
      kind: 'build',
      hidden: 'devday-s12.test.ts',
      allowed: ['src/**', 'test/**', 'README.md', 'notes.txt'],
    },
    behaviors: ['draftPr'],
    reference: {
      files: {
        'src/projects.ts': 'reference/s12/src/projects.ts',
        'src/api.ts': 'reference/s12/src/api.ts',
      },
    },
    checks: [NODE_TESTS],
    expectUsd: { harness: 0.5, 'direct-claude': 0.3, 'direct-codex': 0.25 },
    repairMinutes: 15,
    repairWhy: 'fix the endpoint, push a branch and open the PR by hand',
  },
  {
    id: 's13',
    title: 'Interrupt: Stop mid-build, then "continue"',
    why: 'The second turn resumes the same work; nothing is done twice.',
    repo: 'workbench',
    thread: 'interrupt',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: "Add CSV export for a project's expenses: `expensesCsv(db, projectId): string` in `src/export.ts`, header `id,created_at,amount,note`, rows oldest first (by created_at, then id), the note quoted RFC 4180 style when it contains a comma, quote or newline, `\\n` line endings with a trailing newline. Add tests in `test/export.test.ts`.",
        fakeTags: ' #build #repeat 400',
        interruptAfterMs: { live: 8_000, fake: 2_000 },
      },
      { text: 'continue', fakeTags: ' #build' },
    ],
    expect: {
      kind: 'build',
      hidden: 'devday-s13.test.ts',
      allowed: ['src/**', 'test/**', 'README.md', 'notes.txt'],
    },
    behaviors: ['resumed'],
    reference: { files: { 'src/export.ts': 'reference/s13/src/export.ts' } },
    checks: [NODE_TESTS],
    expectUsd: { harness: 0.6, 'direct-claude': 0.35, 'direct-codex': 0.3 },
    repairMinutes: 20,
    repairWhy: 'untangle half-done and duplicated work',
  },
  {
    id: 's14',
    title: 'Question on a read-only work repo',
    why: 'Answer from feature-web-apps without touching it (its metadata may go to Jev).',
    repo: 'external',
    thread: 'external',
    level: DEFAULT_LEVEL,
    turns: [
      {
        text: "Where does this repo keep its design-system knowledge library, and what does AGENTS.md say the first move on any ticket is? Just answer; don't change anything.",
        fakeTags: '',
      },
    ],
    expect: {
      kind: 'answer',
      answer: [/libs\/foundations\/design-system\/knowledge/, /classif/i],
    },
    behaviors: ['noCrew'],
    expectUsd: { harness: 0.3, 'direct-claude': 0.25, 'direct-codex': 0.2 },
    repairMinutes: 5,
    repairWhy: 'look it up yourself',
  },
];

export function sessionById(id: string): DaySession {
  const found = SESSIONS.find((session) => session.id === id);
  if (!found) throw new Error(`Unknown dev-day session ${id}.`);
  return found;
}
