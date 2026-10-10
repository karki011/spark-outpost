import type { OutpostMember, Run } from '@spark-outpost/contracts';
import type { RequestAuthor, StoredOutpost } from '../../outposts/ports.ts';
import { OutpostError, outpostOf } from '../../persistence/outposts.ts';
import { getRun } from '../../persistence/runs.ts';
import { SparkToolError, type SparkToolContext } from '../tool.ts';

export const NOT_A_CHAT_TURN = 'Outpost tools work only in a turn of a chat.';
export const NOT_THE_CHATS_TURN = "Only the chat's own turn can use outpost tools.";
export const NOT_IN_OUTPOST = 'This chat is not in an outpost.';

export type ChatAuthor = Extract<RequestAuthor, { kind: 'chat' }>;

export interface ChatTurn {
  conversationId: string;
  run: Run;
  startedByRequest: boolean;
}

export interface MemberTurn extends ChatTurn {
  outpost: StoredOutpost;
  member: OutpostMember;
  author: ChatAuthor;
}

export function startedByRequest(run: Pick<Run, 'outpost'>): boolean {
  return run.outpost !== undefined && !run.outpost.fromUser && !run.outpost.userStarted;
}

export async function chatTurn({ deps, scope }: SparkToolContext): Promise<ChatTurn> {
  if (scope.conversationId === null || scope.runId === null) {
    throw new SparkToolError(NOT_A_CHAT_TURN);
  }
  const own = await getRun(deps.db, scope.runId);
  if (!own || own.conversationId !== scope.conversationId) {
    throw new SparkToolError(NOT_A_CHAT_TURN);
  }
  if (own.parentRunId) throw new SparkToolError(NOT_THE_CHATS_TURN);
  return {
    conversationId: scope.conversationId,
    run: own,
    startedByRequest: startedByRequest(own),
  };
}

export async function memberTurn(context: SparkToolContext): Promise<MemberTurn> {
  const turn = await chatTurn(context);
  const found = await outpostOf(context.deps.db, turn.conversationId);
  if (!found) throw new SparkToolError(NOT_IN_OUTPOST);
  return {
    ...turn,
    outpost: found.outpost,
    member: found.member,
    author: {
      kind: 'chat',
      conversationId: turn.conversationId,
      handle: found.member.handle,
      runId: turn.run.id,
      startedByRequest: turn.startedByRequest,
    },
  };
}

export async function asToolError<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof OutpostError) throw new SparkToolError(error.message);
    throw error;
  }
}
