import { clipAtWord } from '@spark-outpost/contracts';

export const TASK_EXCERPT_MAX = 120;

export interface IntroFacts {
  handle: string;
  project: string | null;
  agent: string | null;
  mode: string | null;
}

export interface AgentFacts {
  provider: string;
  model: string | null;
}

export function agentLabel({ provider, model }: AgentFacts): string {
  return model ? `${provider} ${model}` : provider;
}

export function introLine({ handle, project, agent, mode }: IntroFacts): string {
  return [`@${handle} joined`, project, agent, mode].filter(Boolean).join(' · ');
}

export function taskLine(firstMessage: string): string {
  return `Task: ${clipAtWord(firstMessage.replace(/\s+/g, ' '), TASK_EXCERPT_MAX)}`;
}
