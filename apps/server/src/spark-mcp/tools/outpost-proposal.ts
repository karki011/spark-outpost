import { z } from 'zod';
import {
  handleProblem,
  isStacked,
  stackedCount,
  OUTPOST_DRAFT_ACTIVITY,
  OUTPOST_MEMBERS_MAX,
  OUTPOST_NAME_MAX,
  OUTPOST_STORY_TITLE_MAX,
  outpostDraftSchema,
  providerIdSchema,
  SPARK_TEXT_MAX,
  storyProblems,
  type DraftChat,
  type OutpostDraft,
  type OutpostDraftActivity,
  type Project,
  type StoryProblem,
} from '@spark-outpost/contracts';
import { redactText, storableText } from '../../audit/redact.ts';
import {
  chatPosture,
  providerModeChoices,
  providerModePosture,
} from '../../outposts/chat-posture.ts';
import { proposalAboveLead, type ProposedChat } from '../../outposts/mode-cap.ts';
import { proposedModeId, unknownProposedMode } from '../../outposts/proposed-mode.ts';
import { outpostNeeds } from '../../outposts/outpost-availability.ts';
import type { StoredDraft } from '../../outposts/ports.ts';
import { newId } from '../../persistence/ids.ts';
import { saveDraft } from '../../persistence/outpost-drafts.ts';
import { outpostOf } from '../../persistence/outposts.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { listProjects } from '../../projects/projects.ts';
import { runEvents } from '../../workflow/run-events.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';
import { chatTurn, type ChatTurn } from './outpost-turn.ts';
import { at } from './outpost-view.ts';

export const DRAFT_FROM_REQUEST =
  "This turn was started by another chat's request, so it cannot propose chats. Answer in your reply.";
export const DRAFT_NEEDS_PROJECT =
  'Link a project to this chat first: a chat proposes sub-task chats from a project or from inside an outpost.';
const CROSS_REPO_NOTE = 'different repo: order only, no branch base';

const handleInput = z.string().trim().min(1).max(40);

const chatInput = z.object({
  handle: handleInput.describe('Short name in the outpost, such as api.'),
  title: z.string().trim().min(1).max(OUTPOST_STORY_TITLE_MAX),
  project: z.string().trim().min(1).max(200).describe('Project name or id.'),
  agent: providerIdSchema.optional(),
  agentMode: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('A mode id or its name, never above your own mode.'),
  task: z.string().trim().min(1).max(SPARK_TEXT_MAX).describe('The first message the chat gets.'),
  dependsOn: handleInput.optional().describe('Handle of the sub-task this one starts after.'),
});
type ChatInput = z.infer<typeof chatInput>;

export const proposalInput = {
  title: z.string().trim().min(1).max(OUTPOST_STORY_TITLE_MAX).describe('The story, in a line.'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(OUTPOST_NAME_MAX)
    .optional()
    .describe('Outpost name; ignored when this chat is already in one.'),
  chats: z.array(chatInput).min(1).max(OUTPOST_MEMBERS_MAX),
};

export interface ProposalArgs {
  title: string;
  name?: string | undefined;
  chats: ChatInput[];
}

export interface Proposal {
  turn: ChatTurn;
  draft: StoredDraft;
  outpostName: string | null;
  lines: ReturnType<typeof chatLines>;
  projects: readonly Project[];
}

const plainHandle = (handle: string) => handle.replace(/^@/, '').toLowerCase();

function projectOf(projects: readonly Project[], reference: string): Project {
  const wanted = reference.toLowerCase();
  const found = projects.find(
    (project) => project.id === wanted || project.name.toLowerCase() === wanted,
  );
  if (found) return found;
  const names = projects.map((project) => project.name).join(', ') || 'none';
  throw new SparkToolError(`No project called ${reference}. Projects: ${names}.`);
}

function draftChat(chat: ChatInput, projects: readonly Project[]): DraftChat {
  return {
    handle: plainHandle(chat.handle),
    title: chat.title,
    projectId: projectOf(projects, chat.project).id,
    ...(chat.agent ? { agent: chat.agent } : {}),
    ...(chat.agentMode ? { agentMode: chat.agentMode } : {}),
    task: storableText(redactText(chat.task)),
    ...(chat.dependsOn ? { dependsOn: plainHandle(chat.dependsOn) } : {}),
  };
}

function problemLine(problem: StoryProblem): string {
  return problem.kind === 'cycle'
    ? `These chats wait for each other: ${problem.text}. Remove one dependsOn.`
    : problem.text;
}

function refuseProblems(chats: readonly DraftChat[], taken: readonly string[]): void {
  for (const { handle } of chats) {
    const problem = handleProblem(handle, taken);
    if (problem) throw new SparkToolError(`@${handle}: ${problem}`);
  }
  const problems = storyProblems(chats);
  if (problems.length > 0) throw new SparkToolError(problems.map(problemLine).join(' '));
}

async function proposedModes(
  { deps, scope }: SparkToolContext,
  turn: ChatTurn,
  chats: readonly DraftChat[],
): Promise<DraftChat[]> {
  const lead = await chatPosture(deps.db, scope.workspaceId, turn.conversationId);
  const proposed: ProposedChat[] = [];
  const resolved: DraftChat[] = [];
  for (const chat of chats) {
    if (chat.agentMode === undefined) {
      resolved.push(chat);
      continue;
    }
    const provider = chat.agent ?? lead.provider;
    const choices = await providerModeChoices(deps.db, scope.workspaceId, provider);
    const agentMode =
      choices.length === 0 ? chat.agentMode : proposedModeId(choices, chat.agentMode);
    if (agentMode === null) {
      throw new SparkToolError(unknownProposedMode(chat.handle, chat.agentMode, choices));
    }
    resolved.push({ ...chat, agentMode });
    proposed.push({
      handle: chat.handle,
      posture: await providerModePosture(deps.db, scope.workspaceId, provider, agentMode),
    });
  }
  const refusal = proposalAboveLead(lead.posture, proposed);
  if (refusal) throw new SparkToolError(refusal);
  return resolved;
}

function chatLines(chats: readonly DraftChat[], projects: readonly Project[]) {
  const byHandle = new Map(chats.map((chat) => [chat.handle, chat]));
  return chats.map((chat) => {
    const parent = chat.dependsOn === undefined ? null : (byHandle.get(chat.dependsOn) ?? null);
    const stacked = isStacked(chat, parent);
    return {
      handle: at(chat.handle),
      project: projects.find((project) => project.id === chat.projectId)?.name ?? null,
      ...(parent ? { dependsOn: at(parent.handle) } : {}),
      stacked,
      note: !parent
        ? 'parallel: its own branch and pull request from the default branch'
        : stacked
          ? `stacked: its branch and pull request start from ${at(parent.handle)}'s`
          : CROSS_REPO_NOTE,
    };
  });
}

async function showDraftLine(context: SparkToolContext, shown: OutpostDraftActivity) {
  const activity = runEvents.activity(
    `${OUTPOST_DRAFT_ACTIVITY}:${shown.draftId}`,
    OUTPOST_DRAFT_ACTIVITY,
    { ...shown },
  );
  await context.scope.actions?.append(activity).catch((error: unknown) => {
    if (!(error instanceof LeaseLostError)) throw error;
  });
}

export async function saveProposal(
  context: SparkToolContext,
  args: ProposalArgs,
  refuseTurn?: (turn: ChatTurn) => Promise<void>,
): Promise<Proposal> {
  const { deps, scope } = context;
  const turn = await chatTurn(context);
  if (turn.startedByRequest) throw new SparkToolError(DRAFT_FROM_REQUEST);
  await refuseTurn?.(turn);
  if (!(await outpostNeeds(deps.db, scope)).outpost_draft) {
    throw new SparkToolError(DRAFT_NEEDS_PROJECT);
  }
  const joined = await outpostOf(deps.db, turn.conversationId);
  const projects = await listProjects(deps.db, scope.workspaceId);
  const named = args.chats.map((chat) => draftChat(chat, projects));
  refuseProblems(named, joined?.outpost.members.map((member) => member.handle) ?? []);
  const chats = await proposedModes(context, turn, named);
  const body: OutpostDraft = outpostDraftSchema.parse({
    ...(joined || args.name === undefined ? {} : { name: args.name }),
    title: args.title,
    chats,
  });
  const draft = await saveDraft(deps.db, {
    id: newId(),
    workspaceId: scope.workspaceId,
    conversationId: turn.conversationId,
    runId: turn.run.id,
    outpostId: joined?.outpost.id ?? null,
    body,
  });
  const lines = chatLines(body.chats, projects);
  await showDraftLine(context, {
    draftId: draft.id,
    chats: lines.length,
    stacked: stackedCount(body.chats),
  });
  return { turn, draft, outpostName: joined?.outpost.name ?? null, lines, projects };
}
