import { firstName, type Personality, type SparkSessionPrefs } from '@spark-outpost/contracts';
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

export function sparkInstructions(prefs: SparkSessionPrefs, subagents: boolean): string {
  const name = firstName(prefs.displayName);
  const lines = [
    HEADER,
    subagents ? TEAM_WITH_SUBAGENTS : TEAM_WITHOUT_SUBAGENTS,
    ...(name
      ? [`The user's name is ${name}. Use it when you explain something or ask them a question.`]
      : []),
    TONE[prefs.personality],
  ];
  return lines.join('\n').slice(0, SPARK_INSTRUCTIONS_MAX_LENGTH);
}

function joined(first: string | null, second: string): string {
  return first ? `${first}\n\n${second}` : second;
}

const NO_CLAUDE_REPO: ClaudeRepoOptions = {
  appendPrompt: null,
  plugins: [],
  hooks: null,
  mcpNames: [],
  skillTool: false,
  agentTool: false,
};

export function withClaudeSpark(
  repo: ClaudeRepoOptions | null,
  prefs: SparkSessionPrefs | undefined,
  hasTools: boolean,
): ClaudeRepoOptions | null {
  if (!prefs) return repo;
  const base = repo ?? NO_CLAUDE_REPO;
  const subagents = hasTools;
  return {
    ...base,
    appendPrompt: joined(base.appendPrompt, sparkInstructions(prefs, subagents)),
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
): CodexRepoOptions | null {
  if (!prefs) return repo;
  const base = repo ?? NO_CODEX_REPO;
  return {
    ...base,
    developerInstructions: joined(base.developerInstructions, sparkInstructions(prefs, false)),
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
