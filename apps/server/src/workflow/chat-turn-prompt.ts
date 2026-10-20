import { basename } from 'node:path';
import { outpostNeeds } from '../outposts/outpost-availability.ts';
import { chatWorktreeAt } from '../persistence/chat-worktrees.ts';
import type { Queryable } from '../persistence/db.ts';
import { sparkPreferences } from '../persistence/setup.ts';
import { currentBranch } from '../projects/chat-worktrees.ts';
import { isGitWorkTree } from '../projects/snapshot.ts';
import type { Provider } from '../providers/provider.ts';
import { remotes } from '../ship/git.ts';
import type { TurnDeps } from './agent-turn.ts';
import { chatPrompt, type ChatPromptFacts, type ChatPromptProject } from './chat-prompt.ts';
import type { RunInput } from './run-input.ts';

async function projectFacts(db: Queryable, input: RunInput): Promise<ChatPromptProject | null> {
  const folder = input.projectRoots[0];
  if (!folder) return null;
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
  const [project, needs, prefs] = await Promise.all([
    projectFacts(db, input),
    outpostNeeds(db, { conversationId, runId }),
    sparkPreferences(db, input.workspaceId),
  ]);
  return {
    project,
    outpostDraftTool: needs.outpost_draft,
    outpostStartTool: needs.outpost_start,
    level: input.level,
    followUpRound: input.followUpRound === true,
    customInstructions: prefs.agentInstructions ?? null,
  };
}

function sendingChatPrompt(provider: Provider, block: string): Provider {
  return {
    name: provider.name,
    run: (turn) =>
      provider.run(turn.spark ? { ...turn, spark: { ...turn.spark, chatPrompt: block } } : turn),
  };
}

export async function withChatPrompt<Deps extends Pick<TurnDeps, 'db' | 'providers'>>(
  deps: Deps,
  input: RunInput,
): Promise<Deps> {
  const provider = deps.providers.get(input.provider);
  if (!provider || input.assistant) return deps;
  const block = chatPrompt(await chatPromptFacts(deps.db, input));
  const providers = new Map(deps.providers);
  providers.set(input.provider, sendingChatPrompt(provider, block));
  return { ...deps, providers };
}
