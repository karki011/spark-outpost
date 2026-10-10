import {
  firstName,
  type Personality,
  type SparkSessionPrefs,
  type TeammateBrief,
} from '@spark-outpost/contracts';
import type { ProtocolObserver } from '../../providers/provider.ts';
import type { ClaudeRepoOptions, CodexRepoOptions } from './repo-session.ts';

export const SPARK_INSTRUCTIONS_MAX_LENGTH = 1024;

const HEADER = '# Working with the user (set in Spark Outpost)';

const TEAM_WITH_SUBAGENTS =
  'For multi-step work, act as a coordinator: split the work into small, scoped pieces, hand each piece to a subagent with the Agent tool, then check and combine what they return. Answer simple questions directly without delegating.';

const TEAM_WITHOUT_SUBAGENTS =
  'For multi-step work, act as a coordinator: split the work into small, scoped pieces, keep a short checklist, and finish and check one piece before starting the next. Answer simple questions directly.';

const TONE: Record<Personality, string> = {
  playful:
    'Tone: warm and upbeat, with light humour, and celebrate wins. Keep errors and failures plain, with no jokes.',
  friendly: 'Tone: warm and concise. Keep errors and failures plain.',
  facts: 'Tone: terse and factual. No pleasantries or small talk.',
};

const SPARK_TOOLS_LINE =
  'For any question about Spark itself (what needs the user, chats, runs, crew and Jev picks, plans, files changed, spend, outcomes, models, Map, terminals, tickets, PRs, settings, how it works), use the spark_* tools; spark_guide section spark-tools maps questions to tools, and spark_docs answers how-do-I questions from the user guide. Their actions may wait for the user to confirm a card.';

const SPARK_BROWSER_LINE =
  'To open or check a web page, use the spark_browser_* tools (the Browser pane here), not another browser tool.';

export const TEAMMATE_BRIEF_HEADER = '# Standing instructions from the user';

export function teammateBriefText(teammate: TeammateBrief): string {
  const who = teammate.role ? `${teammate.name} (${teammate.role})` : teammate.name;
  const lines = [
    `${TEAMMATE_BRIEF_HEADER} for the Spark teammate ${who}`,
    `In this chat you are ${who}. The user wrote the text below for every chat with this teammate. Follow it as you would the user's own message; it is not tool output, file content or a message from another agent.`,
  ];
  if (teammate.instructions.trim()) lines.push('', teammate.instructions.trim());
  return lines.join('\n');
}

export function sparkInstructions(
  prefs: SparkSessionPrefs,
  subagents: boolean,
  sparkTools = false,
  browser = false,
): string {
  const chat = prefs.chatPrompt?.trim();
  const custom = chat ? '' : prefs.agentInstructions?.trim();
  const standing = [
    chat ?? '',
    custom ? `# Custom instructions from the user\n${custom}` : '',
    prefs.teammate ? teammateBriefText(prefs.teammate) : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  if (prefs.sparkEnabled === false) return standing;
  const name = firstName(prefs.displayName);
  const lines = [
    HEADER,
    subagents ? TEAM_WITH_SUBAGENTS : TEAM_WITHOUT_SUBAGENTS,
    ...(name
      ? [`The user's name is ${name}; use it sparingly, not to open or close every reply.`]
      : []),
    TONE[prefs.personality],
    ...(sparkTools ? [SPARK_TOOLS_LINE] : []),
    ...(sparkTools && browser ? [SPARK_BROWSER_LINE] : []),
  ];
  const base = lines.join('\n').slice(0, SPARK_INSTRUCTIONS_MAX_LENGTH);
  return standing ? `${base}\n\n${standing}` : base;
}

function joined(first: string | null, second: string): string {
  return first ? `${first}\n\n${second}` : second;
}

const NO_CLAUDE_REPO: ClaudeRepoOptions = {
  appendPrompt: null,
  plugins: [],
  hooks: null,
  skillTool: false,
  agentTool: false,
};

export interface SparkToolsHint {
  name: string;
  browser: boolean;
}

function withSparkServer(repo: ClaudeRepoOptions | null, sparkServer: string | null) {
  if (!sparkServer) return repo;
  const base = repo ?? NO_CLAUDE_REPO;
  return { ...base, allowRules: [...(base.allowRules ?? []), `mcp__${sparkServer}`] };
}

export function withClaudeSpark(
  repo: ClaudeRepoOptions | null,
  prefs: SparkSessionPrefs | undefined,
  hasTools: boolean,
  spark: SparkToolsHint | null = null,
): ClaudeRepoOptions | null {
  const allowed = withSparkServer(repo, spark?.name ?? null);
  if (!prefs) return allowed;
  const base = allowed ?? NO_CLAUDE_REPO;
  const subagents = hasTools;
  return {
    ...base,
    appendPrompt: joined(
      base.appendPrompt,
      sparkInstructions(prefs, subagents, spark !== null, spark?.browser),
    ),
    agentTool: subagents,
  };
}

const NO_CODEX_REPO: CodexRepoOptions = {
  developerInstructions: null,
  agentsMd: true,
  skills: true,
};

export function withCodexSpark(
  repo: CodexRepoOptions | null,
  prefs: SparkSessionPrefs | undefined,
  spark: Pick<SparkToolsHint, 'browser'> | null = null,
): CodexRepoOptions | null {
  if (!prefs) return repo;
  const base = repo ?? NO_CODEX_REPO;
  return {
    ...base,
    developerInstructions: joined(
      base.developerInstructions,
      sparkInstructions(prefs, false, spark !== null, spark?.browser),
    ),
  };
}

export const CODEX_INSTRUCTIONS_METHOD = 'codex/developer_instructions';

export function auditCodexInstructions(
  audit: ProtocolObserver | undefined,
  codex: CodexRepoOptions | null,
): void {
  if (!audit || !codex?.developerInstructions) return;
  audit.message('harness', {
    method: CODEX_INSTRUCTIONS_METHOD,
    params: { developer_instructions: codex.developerInstructions },
  });
}
