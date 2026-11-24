import { basename } from 'node:path';
import { builderChatScope } from '../crew-flows/builder-chat.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { splitsIntoSubChats } from '../sub-chats/availability.ts';
import { sparkPreferences, type SparkPreferences } from '../persistence/setup.ts';
import { currentBranch } from '../projects/chat-worktrees.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import type { Provider } from '../providers/provider.ts';
import { remotes } from '../ship/git.ts';
import type { TurnDeps } from './agent-turn.ts';
import {
  chatPrompt,
  chatTurnNote,
  type ChatPromptFacts,
  type ChatPromptProject,
  type ChatTurnFacts,
} from './chat-prompt.ts';
import type { RunInput } from './run-input.ts';

async function projectFacts(db: Queryable, input: RunInput): Promise<ChatPromptProject | null> {
  const folder = input.projectRoots[0];
  if (!folder || input.chatFolder) return null;
  const worktree = await chatWorktreeAt(db, folder);
  const [found, gitRepo] = await Promise.all([
    remotes(folder).catch(() => []),
    isGitWorkTree(folder),
  ]);
  return {
    folder,
    branch: worktree?.branch ?? (await currentBranch(folder).catch(() => null)),
    repo: basename(worktree?.repoRoot ?? folder),
    place: worktree ? 'worktree' : 'checkout',
    linkedRepos: input.projectRoots.slice(1).map((root) => basename(root)),
    hasRemote: found.length > 0,
    gitRepo,
  };
}

export async function chatPromptFacts(
  db: Queryable,
  input: RunInput,
  known?: SparkPreferences,
): Promise<ChatPromptFacts> {
  const conversationId = input.identity.threadId;
  const [project, prefs, builderChat, subChatsTool] = await Promise.all([
    projectFacts(db, input),
    known ?? sparkPreferences(db, input.workspaceId),
    builderChatScope(db, conversationId),
    splitsIntoSubChats(db, conversationId),
  ]);
  return {
    project,
    subChatsTool: subChatsTool && input.workflowStarted !== true,
    level: input.workflowStarted ? 'hands-off' : input.level,
    asksWithTool: input.mode === 'do' && input.plansFirst !== true,
    ...(builderChat ? { builderChat } : {}),
    customInstructions: prefs.agentInstructions ?? null,
  };
}

export function isTaskTurn(input: Pick<RunInput, 'chatAsk'>): boolean {
  return input.chatAsk?.kind === 'task';
}

const ACTIVE = `('queued', 'running', 'awaiting_approval')`;

async function roundRunning(db: Queryable, input: RunInput) {
  if (input.parentRunId !== null || input.followUpLane) return null;
  const { rows } = await db.query<{ number: number; round: number; doing: string }>(
    `SELECT w.number, w.rounds AS round, COALESCE(w.doing, '') AS doing FROM pr_watches w
     JOIN runs r ON r.id = w.round_run_id
     WHERE w.conversation_id = $1 AND w.phase = 'fixing' AND r.status IN ${ACTIVE}
     ORDER BY r.created_at DESC LIMIT 1`,
    [input.identity.threadId],
  );
  return rows[0] ?? null;
}

export function chatTurnNoteFor(
  input: RunInput,
  facts: ChatPromptFacts,
  round: ChatTurnFacts['roundRunning'] = null,
): string | null {
  return chatTurnNote({
    project: facts.project,
    followUpRound: input.followUpRound === true,
    taskTurn: isTaskTurn(input),
    roundRunning: round,
  });
}

function sendingChatPrompt(provider: Provider, block: string, note: string | null): Provider {
  return {
    name: provider.name,
    run: (turn) => {
      const spark = turn.spark ? { ...turn.spark, chatPrompt: block } : turn.spark;
      const turnPreamble = [note, turn.turnPreamble].filter(Boolean).join('\n\n');
      return provider.run({
        ...turn,
        ...(spark ? { spark } : {}),
        ...(turnPreamble ? { turnPreamble } : {}),
      });
    },
  };
}

export async function withChatPrompt<Deps extends Pick<TurnDeps, 'db' | 'providers'>>(
  deps: Deps,
  input: RunInput,
  prefs?: SparkPreferences,
): Promise<Deps> {
  const provider = deps.providers.get(input.provider);
  if (!provider || input.assistant) return deps;
  const [facts, round] = await Promise.all([
    chatPromptFacts(deps.db, input, prefs),
    roundRunning(deps.db, input),
  ]);
  const providers = new Map(deps.providers);
  providers.set(
    input.provider,
    sendingChatPrompt(provider, chatPrompt(facts), chatTurnNoteFor(input, facts, round)),
  );
  return { ...deps, providers };
}
