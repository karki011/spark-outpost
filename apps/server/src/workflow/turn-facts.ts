import { briefWithFile } from '../projects/instructions-file.ts';
import type { Db } from '../persistence/db.ts';
import { sparkPreferences, type SparkPreferences } from '../persistence/setup.ts';
import { subagentBrief } from '../persistence/spark-mentions.ts';
import { teammateBrief } from '../persistence/teammate-chats.ts';
import { plansThisTurn } from '../plans/plan-mode.ts';
import type { LiveTurn } from '../providers/provider.ts';
import { withBrowserCheck } from './browser-check.ts';
import type { RunInput } from './run-input.ts';
import type { TurnSession } from './turn-session.ts';

export function editsFiles(input: RunInput): boolean {
  if (input.mode !== 'do' || input.assistant || plansThisTurn(input)) return false;
  return input.role === null;
}

export function asksThroughGate(input: RunInput): boolean {
  if (input.mode !== 'ask' || input.projectRoots.length === 0) return false;
  return input.role === null || (input.role === 'spark' && input.workflowStep === true);
}

export function promptWithBrowserCheck(prompt: string, input: RunInput, browserPane: boolean) {
  return withBrowserCheck({
    prompt,
    userRequest: input.userRequest,
    editsFiles: editsFiles(input),
    browserPane,
  });
}

async function sessionBrief(db: Db, input: RunInput) {
  if (input.assistant) return null;
  if (input.parentRunId && input.role !== 'spark') return null;
  const brief = input.parentRunId
    ? await subagentBrief(db, input.identity.runId)
    : await teammateBrief(db, input.identity.threadId);
  return brief ? briefWithFile(brief) : null;
}

export async function sparkSession(db: Db, input: RunInput, known?: SparkPreferences) {
  const prefs = known ?? (await sparkPreferences(db, input.workspaceId));
  return { ...prefs, teammate: await sessionBrief(db, input) };
}

export function liveTurn(input: RunInput, session: TurnSession | null): { live?: LiveTurn } {
  if (!session || input.parentRunId !== null || input.assistant) return {};
  const conversationId = input.identity.threadId;
  return { live: input.agentCycle ? { conversationId, continuation: true } : { conversationId } };
}
