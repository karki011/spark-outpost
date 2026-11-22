import { modePosture, type ModePosture } from './agent-modes.ts';
import type { InvolvementLevel } from './involvement-levels.ts';

export interface SparkMeansFacts {
  name: string;
  provider: string | null;
  mode: string | null;
  kind?: string | null;
  level: InvolvementLevel | null;
}

const WORK_LINES: Readonly<Record<Exclude<ModePosture, 'read_only' | 'unknown'>, string>> = {
  asks: 'changes files, asking before each edit and command',
  edits: 'changes files without asking and asks before it runs a command',
  auto: 'changes files without asking and decides itself when to ask',
  denies: 'changes files without asking and skips anything not approved in advance',
  full_access: 'changes files and runs commands without asking',
};

const RESULT_LINES: Readonly<Record<InvolvementLevel, string>> = {
  'hands-off': 'keeps its changes and opens no pull request unless you ask',
  'full-auto': 'opens its own pull request',
};

const RESULT_FROM_SETTINGS = 'Whether it opens a pull request follows Settings → Chats & autonomy.';

function resultSentence(level: InvolvementLevel | null): string {
  return level ? `It ${RESULT_LINES[level]}.` : RESULT_FROM_SETTINGS;
}

export function sparkChatMeans(facts: SparkMeansFacts): string {
  const name = facts.name.trim() || 'This Spark';
  if (!facts.mode) {
    return `${name} follows the mode of the chat it works in. ${resultSentence(facts.level)}`;
  }
  const posture = modePosture(facts.provider, facts.mode, facts.kind ?? null);
  if (posture === 'read_only') return `${name} reads and reports. It changes no files.`;
  if (posture === 'unknown') {
    return `${name} works in a mode Spark does not know, so the agent decides when to ask. ${resultSentence(facts.level)}`;
  }
  if (facts.level === 'full-auto') {
    return `${name} ${WORK_LINES[posture]}, and ${RESULT_LINES['full-auto']}.`;
  }
  return `${name} ${WORK_LINES[posture]}. ${resultSentence(facts.level)}`;
}

export function sparkJobMeans(name: string): string {
  const who = name.trim() || 'this Spark';
  return `Handed one job with @${who} or as a workflow step, it reads and reports.`;
}
