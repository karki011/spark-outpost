import { z } from 'zod';
import {
  handleProblem,
  isStacked,
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
import { chatPosture, providerModePosture } from '../../outposts/chat-posture.ts';
import { proposalAboveLead, type ProposedChat } from '../../outposts/mode-cap.ts';
import { outpostNeeds } from '../../outposts/outpost-availability.ts';
import { newId } from '../../persistence/ids.ts';
import { saveDraft } from '../../persistence/outpost-drafts.ts';
import { outpostOf } from '../../persistence/outposts.ts';
import { LeaseLostError } from '../../persistence/run-events.ts';
import { listProjects } from '../../projects/projects.ts';
import { runEvents } from '../../workflow/run-events.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { chatTurn, type ChatTurn } from './outpost-turn.ts';
import { at } from './outpost-view.ts';

export const DRAFT_FROM_REQUEST =
  "This turn was started by another chat's request, so it cannot propose chats. Answer in your reply.";
export const DRAFT_NEEDS_PROJECT =
  'Link a project to this chat first: a chat proposes sub-task chats from a project or from inside an outpost.';
const CROSS_REPO_NOTE = 'different repo: order only, no branch base';
const NEXT =
  'Nothing was created and no chat was asked. The user reviews the draft from the line in this chat, can change it, and starts it; say it is ready. Each first message runs as your text, not the user’s, under that chat’s own mode and autonomy.';

const handleInput = z.string().trim().min(1).max(40);

const chatInput = z.object({
  handle: handleInput.describe('Short name in the outpost, such as api.'),
  title: z.string().trim().min(1).max(OUTPOST_STORY_TITLE_MAX),
  project: z.string().trim().min(1).max(200).describe('Project name or id.'),
  agent: providerIdSchema.optional(),
  agentMode: z.string().trim().min(1).max(200).optional().describe('Never above your own mode.'),
  task: z.string().trim().min(1).max(SPARK_TEXT_MAX).describe('The first message the chat gets.'),
  dependsOn: handleInput.optional().describe('Handle of the sub-task this one starts after.'),
});
type ChatInput = z.infer<typeof chatInput>;

interface DraftArgs {
  title: string;
  name?: string | undefined;
  chats: ChatInput[];
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

async function refuseModesAboveOwn(
  { deps, scope }: SparkToolContext,
  turn: ChatTurn,
  chats: readonly DraftChat[],
): Promise<void> {
  const lead = await chatPosture(deps.db, scope.workspaceId, turn.conversationId);
  const proposed: ProposedChat[] = [];
  for (const chat of chats) {
    if (chat.agentMode === undefined) continue;
    const provider = chat.agent ?? lead.provider;
    proposed.push({
      handle: chat.handle,
      posture: await providerModePosture(deps.db, scope.workspaceId, provider, chat.agentMode),
    });
  }
  const refusal = proposalAboveLead(lead.posture, proposed);
  if (refusal) throw new SparkToolError(refusal);
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

async function draft(context: SparkToolContext, args: DraftArgs) {
  const { deps, scope } = context;
  const turn = await chatTurn(context);
  if (turn.startedByRequest) throw new SparkToolError(DRAFT_FROM_REQUEST);
  if (!(await outpostNeeds(deps.db, scope)).outpost_draft) {
    throw new SparkToolError(DRAFT_NEEDS_PROJECT);
  }
  const joined = await outpostOf(deps.db, turn.conversationId);
  const projects = await listProjects(deps.db, scope.workspaceId);
  const chats = args.chats.map((chat) => draftChat(chat, projects));
  refuseProblems(chats, joined?.outpost.members.map((member) => member.handle) ?? []);
  await refuseModesAboveOwn(context, turn, chats);
  const body: OutpostDraft = outpostDraftSchema.parse({
    ...(joined || args.name === undefined ? {} : { name: args.name }),
    title: args.title,
    chats,
  });
  const saved = await saveDraft(deps.db, {
    id: newId(),
    workspaceId: scope.workspaceId,
    conversationId: turn.conversationId,
    runId: turn.run.id,
    outpostId: joined?.outpost.id ?? null,
    body,
  });
  const lines = chatLines(body.chats, projects);
  await showDraftLine(context, {
    draftId: saved.id,
    chats: lines.length,
    stacked: lines.filter((line) => line.stacked).length,
  });
  return { draft: saved.id, chats: lines, next: NEXT };
}

export const outpostDraftTool = sparkTool({
  name: 'spark_outpost_draft',
  title: 'Propose sub-task chats',
  needs: 'outpost_draft',
  description:
    'Propose splitting work into sub-task chats, each with its own project, branch and pull request, for work that spans repos or needs separate reviews (one change in one repo stays in this chat). Saves a draft and shows the user one line to review; it creates no chat and starts nothing until the user starts it. Leave dependsOn empty when a sub-task can be built and reviewed alone from the default branch (parallel PRs). Set it when the sub-task needs the other’s code or edits the same files: same repo → its branch and PR stack on that one; other repo → it only starts after. Refuses rings, unknown handles or projects, and a mode above your own.',
  input: {
    title: z.string().trim().min(1).max(OUTPOST_STORY_TITLE_MAX).describe('The story, in a line.'),
    name: z
      .string()
      .trim()
      .min(1)
      .max(OUTPOST_NAME_MAX)
      .optional()
      .describe('Outpost name; ignored when this chat is already in one.'),
    chats: z.array(chatInput).min(1).max(OUTPOST_MEMBERS_MAX),
  },
  run: (args, context) => draft(context, args),
});
