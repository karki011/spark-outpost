import {
  HELD_ASK_RULES,
  type SparkRuleChoice,
  type SparkRuleRow,
  type UnusedRuleEntry,
} from '@spark-outpost/contracts';

export interface RuleRowCopy {
  row: SparkRuleRow;
  label: string;
}

export interface RuleGroup {
  id: string;
  title: string;
  note?: string;
  rows: readonly RuleRowCopy[];
}

export const ALLOWED_LABEL = 'Allowed gh commands';

export const RULE_GROUPS: readonly RuleGroup[] = [
  {
    id: 'publishing',
    title: 'Publishing',
    note: 'Asked means your message asks, the chat is at Full auto → PR, or the mode is Auto, Bypass permissions or Full access.',
    rows: [
      { row: 'Push', label: "Push the chat's branch without being asked" },
      { row: 'PullRequest', label: "Open or edit the chat's pull request without being asked" },
      { row: 'Push(other)', label: 'Push any other branch' },
      { row: 'Push(force)', label: 'Force push' },
    ],
  },
  {
    id: 'github',
    title: 'GitHub commands',
    note: 'Ask Spark never merges, approves or dismisses reviews, whatever these say.',
    rows: [
      { row: 'workflows', label: 'Run a workflow' },
      { row: 'Gh(pr merge)', label: 'Merge a pull request' },
      { row: 'Gh(pr review)', label: 'Review or approve a pull request' },
      { row: 'GhAdmin', label: 'Use --admin' },
      { row: 'Gh(auth)', label: 'Change the gh sign-in' },
      { row: 'Gh(api write)', label: 'Write with gh api' },
      { row: 'Gh(*)', label: 'Any other gh command' },
    ],
  },
  {
    id: 'files',
    title: 'Files',
    rows: [
      { row: 'SecretFile(edit)', label: 'Change or delete secret files' },
      { row: 'SecretFile(read)', label: 'Read files listed in .sparkignore' },
      { row: 'InstructionFile(edit)', label: 'Agent instruction files' },
      { row: 'GitConfig', label: 'Git hooks and config' },
      { row: 'WriteOutside', label: 'Write outside the project' },
    ],
  },
  {
    id: 'sending',
    title: 'Sending',
    rows: [
      { row: 'SecretSend', label: 'Send a value from a secret file' },
      { row: 'GitRemote', label: 'Change remotes or publish another way' },
    ],
  },
];

export const SPARK_RULES_ROWS: readonly string[] = [
  ...RULE_GROUPS.flatMap((group) => group.rows.map((row) => row.label)),
  ALLOWED_LABEL,
];

const ALLOW_CHANGES: ReadonlySet<SparkRuleRow> = new Set(['workflows']);
const HELD: ReadonlySet<string> = new Set(HELD_ASK_RULES);

export interface ChoiceCopy {
  id: SparkRuleChoice;
  label: string;
  description: string;
}

export function choiceLabel(row: SparkRuleRow, choice: SparkRuleChoice): string {
  if (choice === 'mode') return "Agent's mode";
  if (choice === 'allow') return 'Allow';
  if (choice === 'deny') return 'Refuse';
  return HELD.has(row) ? 'Ask, hold to confirm' : 'Ask';
}

export function shownChoice(row: SparkRuleRow, choice: SparkRuleChoice): SparkRuleChoice {
  return choice === 'allow' && !ALLOW_CHANGES.has(row) ? 'mode' : choice;
}

export function choicesFor(row: SparkRuleRow): ChoiceCopy[] {
  const allow: ChoiceCopy = {
    id: 'allow',
    label: choiceLabel(row, 'allow'),
    description: "Follows the agent's mode, even when other gh commands are refused",
  };
  return [
    {
      id: 'mode',
      label: choiceLabel(row, 'mode'),
      description: "No rule: the agent's mode decides",
    },
    ...(ALLOW_CHANGES.has(row) ? [allow] : []),
    { id: 'ask', label: choiceLabel(row, 'ask'), description: 'Asks in every mode' },
    { id: 'deny', label: choiceLabel(row, 'deny'), description: 'Refused in every mode' },
  ];
}

export function unusedKindLabel(kind: UnusedRuleEntry['kind']): string {
  if (kind === 'key') return 'Unknown key';
  if (kind === 'agent-tool') return "Agent tool rule: put it in Claude's settings";
  return 'Not a Spark rule';
}
