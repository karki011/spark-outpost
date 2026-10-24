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
  rows: readonly RuleRowCopy[];
}

export const MERGE_LABEL = 'Merge, approve or dismiss reviews';
export const ALLOWED_LABEL = 'Allowed gh commands';

export const RULE_GROUPS: readonly RuleGroup[] = [
  {
    id: 'publishing',
    title: 'Publishing',
    rows: [
      { row: 'Push', label: "Push the chat's own branch" },
      { row: 'Push(other)', label: 'Push any other branch' },
      { row: 'Push(force)', label: 'Force push' },
      { row: 'PullRequest', label: "Open or edit the chat's pull request" },
    ],
  },
  {
    id: 'github',
    title: 'GitHub commands',
    rows: [
      { row: 'workflows', label: 'Run a workflow' },
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
      { row: 'GitRemote', label: 'Add or change git remotes' },
    ],
  },
];

export const SPARK_RULES_ROWS: readonly string[] = [
  ...RULE_GROUPS.flatMap((group) => group.rows.map((row) => row.label)),
  MERGE_LABEL,
  ALLOWED_LABEL,
];

const GH_ROWS: ReadonlySet<SparkRuleRow> = new Set(['workflows', 'Gh(*)']);
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

function allowDescription(row: SparkRuleRow): string {
  return GH_ROWS.has(row)
    ? "Follows the agent's mode, even when other gh commands are refused"
    : "Follows the agent's mode, written in your file";
}

export function choicesFor(row: SparkRuleRow): ChoiceCopy[] {
  return [
    {
      id: 'mode',
      label: choiceLabel(row, 'mode'),
      description: "No rule: the agent's mode decides",
    },
    { id: 'allow', label: choiceLabel(row, 'allow'), description: allowDescription(row) },
    { id: 'ask', label: choiceLabel(row, 'ask'), description: 'Asks in every mode' },
    { id: 'deny', label: choiceLabel(row, 'deny'), description: 'Refused in every mode' },
  ];
}

export function unusedKindLabel(kind: UnusedRuleEntry['kind']): string {
  if (kind === 'key') return 'Unknown key';
  if (kind === 'agent-tool') return "Agent tool rule: put it in Claude's settings";
  return 'Not a Spark rule';
}
