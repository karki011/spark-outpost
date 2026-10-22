export const CLAUDE_READ_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'ListMcpResources',
  'ReadMcpResource',
  'ReadMcpResourceDir',
  'RefreshMcpTools',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'ToolSearch',
] as const;

export const CLAUDE_GATED_TOOLS = ['WebSearch', 'WebFetch', 'Bash', 'Monitor', 'TaskStop'] as const;

export const CLAUDE_PLAN_TOOLS = ['Write', 'ExitPlanMode'] as const;

export const CLAUDE_QUESTION_TOOLS = ['AskUserQuestion'] as const;

export const CLAUDE_DO_TOOLS = [
  ...CLAUDE_READ_TOOLS,
  ...CLAUDE_GATED_TOOLS,
  'Edit',
  'Write',
  'NotebookEdit',
  'TodoWrite',
  'ReportFindings',
  'EnterPlanMode',
  'ExitPlanMode',
  ...CLAUDE_QUESTION_TOOLS,
] as const;

export const CLAUDE_REPO_TOOLS = ['Skill', 'Agent'] as const;

export const CLAUDE_OFF_TOOLS: Readonly<Record<string, string>> = {
  EnterWorktree: 'moves the session out of the folder Spark placed the chat in',
  ExitWorktree: "moves the session back and can delete the worktree and branch Spark doesn't own",
  CronCreate: 'schedules work that runs outside a turn',
  CronDelete: 'manages work that runs outside a turn',
  CronList: 'lists work that runs outside a turn',
  ScheduleWakeup: 'wakes the agent outside a turn',
  RemoteTrigger: 'starts work outside a turn',
  PushNotification: "sends a notification off this computer outside Spark's own notifications",
  Artifact: 'publishes a page to claude.ai',
  ArtifactComments: 'publishes comments on a claude.ai page',
  ArtifactData: 'writes data on a claude.ai page',
  DesignSync: 'syncs a design system with claude.ai',
  ClaudeDesign: 'works on designs in claude.ai',
  Projects: 'reads and changes claude.ai projects',
  SendMessage: 'messages other Claude sessions, including ones on other machines',
  ListAgents: 'lists other Claude sessions on this computer',
  Workflow: "runs workflow scripts, including the repo's unreviewed ones, as background work",
  SendFeedback: 'sends feedback to Anthropic',
  ProposeSkills: 'writes skills outside the project',
  ProposeGoal: 'sets a goal that re-prompts the agent on its own; Spark decides when a turn ends',
  ReadNotifications: 'reads claude.ai notifications',
  ShowOnboardingRolePicker: 'shows Claude Code onboarding',
};

export const CLAUDE_OFF_TOOL_NAMES = Object.keys(CLAUDE_OFF_TOOLS);

export const CLAUDE_GATED_ASK_RULES = ['WebFetch', 'Monitor'] as const;

export const WEB_FETCH_LOCAL_DENY_RULES = [
  'WebFetch(domain:localhost)',
  'WebFetch(domain:*.localhost)',
  'WebFetch(domain:*.test)',
  'WebFetch(domain:127.0.0.1)',
  'WebFetch(domain:0.0.0.0)',
  'WebFetch(domain:[::1])',
  'WebFetch(domain:[::])',
];

export function gatedAskRules(tools: readonly string[]): string[] {
  return CLAUDE_GATED_ASK_RULES.filter((tool) => tools.includes(tool));
}

export function toolDenyRules(tools: readonly string[]): string[] {
  if (tools.length === 0) return [];
  return [
    ...CLAUDE_OFF_TOOL_NAMES,
    ...(tools.includes('WebFetch') ? WEB_FETCH_LOCAL_DENY_RULES : []),
  ];
}
