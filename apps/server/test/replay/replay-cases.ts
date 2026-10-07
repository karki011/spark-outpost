import { PLAN_REPLY_TRIGGER } from '../fake-acp-plans.ts';
import { NORMAL, RISKY, TRIVIAL, type JevScript, type Scenario } from '../orchestration-support.ts';

export interface ReplayTurn {
  scenario: Scenario;
  level?: 'hands-off' | 'full-auto';
  source?: 'pr_follow_up';
  jev?: Pick<JevScript, 'verify' | 'verdicts'>;
}

export interface ReplayCase {
  id: string;
  title: string;
  repo?: 'remote';
  coordinator?: 'in_order' | 'parallel';
  pieceCheck?: boolean;
  failingCheck?: boolean;
  turns: readonly ReplayTurn[];
}

const say = (base: Scenario, text: string, extra: Partial<Scenario> = {}): Scenario => ({
  ...base,
  ...extra,
  text,
});

const PLAN: Scenario = {
  id: 'plan',
  text: `Plan adding CSV export to Analytics. Plan only for now: don't change any files. ${PLAN_REPLY_TRIGGER}`,
  mode: 'do',
  question: 0.69,
  planOnly: 0.9,
  destructive: 0.02,
  intent: 'feature',
};

const STATUS: Scenario = {
  id: 'status',
  text: 'Where are we? What changed so far?',
  mode: 'do',
  question: 0.97,
  destructive: 0.01,
  continuesTask: 0.9,
  intent: 'question',
  tier: 'small',
};

const FOLLOW_UP = say(TRIVIAL, 'Also fix the same typo in the footer. #build', {
  continuesTask: 0.95,
});

const REVIEWED = say(NORMAL, `${NORMAL.text} Review it when done.`, { review: 0.95 });

const SPLIT = say(NORMAL, `${NORMAL.text} Split this up. #pieces`);

const GROWS = say(
  TRIVIAL,
  'Fix the typo in the README heading and wherever else it appears. #build',
);

const ROUND = say(
  NORMAL,
  'Review feedback on your pull request: handle the empty list in notes.txt. #build',
  { continuesTask: 0.95 },
);

const UNSUPPORTED = {
  verify: 0.92,
  verdicts: [
    { choice: 'unsupported', confidence: 0.93 },
    { choice: 'supported', confidence: 0.95 },
  ],
};

export const REPLAY_CASES: readonly ReplayCase[] = [
  { id: 'plan', title: 'Plan turn', turns: [{ scenario: PLAN }] },
  {
    id: 'follow-up',
    title: 'One-line follow-up',
    turns: [{ scenario: NORMAL }, { scenario: FOLLOW_UP }],
  },
  {
    id: 'status',
    title: 'Status question after build turns',
    turns: [{ scenario: NORMAL }, { scenario: FOLLOW_UP }, { scenario: STATUS }],
  },
  {
    id: 'check-fix',
    title: 'Check-fix, failures in untouched files',
    failingCheck: true,
    turns: [{ scenario: TRIVIAL, level: 'full-auto' }],
  },
  {
    id: 'publish',
    title: 'Publish',
    repo: 'remote',
    turns: [{ scenario: NORMAL, level: 'full-auto' }],
  },
  {
    id: 'pr-follow-up',
    title: 'PR follow-up round',
    repo: 'remote',
    turns: [
      { scenario: NORMAL, level: 'full-auto' },
      { scenario: ROUND, level: 'full-auto', source: 'pr_follow_up' },
    ],
  },
  { id: 'review', title: 'Review request', turns: [{ scenario: REVIEWED }] },
  {
    id: 'build-3',
    title: 'Build, 3 subtasks',
    coordinator: 'in_order',
    pieceCheck: true,
    turns: [{ scenario: SPLIT }],
  },
  {
    id: 'parallel',
    title: 'Parallel build, shared tree',
    coordinator: 'parallel',
    pieceCheck: true,
    turns: [{ scenario: SPLIT }],
  },
  {
    id: 'escalated',
    title: 'Escalated subtask',
    turns: [{ scenario: NORMAL, level: 'full-auto', jev: UNSUPPORTED }],
  },
  {
    id: 'grows',
    title: 'Small change that grows',
    turns: [{ scenario: GROWS, level: 'full-auto', jev: UNSUPPORTED }],
  },
  { id: 'risky', title: 'Destructive request', turns: [{ scenario: RISKY }] },
];
