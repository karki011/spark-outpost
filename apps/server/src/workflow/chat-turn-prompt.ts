import { basename } from 'node:path';
import { outpostNeeds } from '../outposts/outpost-availability.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { storyTaskOf } from '../persistence/outpost-stories.ts';
import { sparkPreferences } from '../persistence/setup.ts';
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

export async function chatPromptFacts(db: Queryable, input: RunInput): Promise<ChatPromptFacts> {
  const { threadId: conversationId, runId } = input.identity;
  const [project, needs, prefs, storyTask] = await Promise.all([
    projectFacts(db, input),
    outpostNeeds(db, { conversationId, runId }),
    sparkPreferences(db, input.workspaceId),
    storyTaskOf(db, conversationId),
  ]);
  return {
    project,
    outpostDraftTool: needs.outpost_draft,
    outpostStartTool: needs.outpost_start,
    level: input.level,
    asksWithTool: input.mode === 'do' && input.plansFirst !== true,
    assignedWork: storyTask !== null,
    customInstructions: prefs.agentInstructions ?? null,
  };
}

export function requestAssignedWork(input: Pick<RunInput, 'outpostRequest'>): boolean {
  const request = input.outpostRequest;
  return request != null && !request.fromUser && !request.wrapUp;
}

export function chatTurnNoteFor(input: RunInput, facts: ChatPromptFacts): string | null {
  return chatTurnNote({
    project: facts.project,
    followUpRound: input.followUpRound === true,
    requestAssigned: !facts.assignedWork && requestAssignedWork(input),
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
): Promise<Deps> {
  const provider = deps.providers.get(input.provider);
  if (!provider || input.assistant) return deps;
  const facts = await chatPromptFacts(deps.db, input);
  const providers = new Map(deps.providers);
  providers.set(
    input.provider,
    sendingChatPrompt(provider, chatPrompt(facts), chatTurnNoteFor(input, facts)),
  );
  return { ...deps, providers };
}
