import { z } from 'zod';
import {
  subChatPieceSchema,
  subChatPlacement,
  type StartSubChatsAction,
} from '@spark-outpost/contracts';
import { redactText, storableText } from '../../audit/redact.ts';
import { SUB_CHAT_CANNOT_BE_PARENT } from '../../persistence/sub-chats.ts';
import { turnStart } from '../../sub-chats/asks.ts';
import { planFacts, PlanFactsError } from '../../sub-chats/plan-facts.ts';
import { planSubChats } from '../../sub-chats/plan.ts';
import { deviceRefusal } from '../actions/ask-spark-limits.ts';
import { actionRun, auditAction, proposeAction } from '../actions/confirm.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

export const NOT_FROM_ANOTHER_CHAT =
  'This turn was started by a message from another chat, so it cannot start sub-chats. Tell the user if the work needs splitting.';
export const ONLY_A_CHAT_TURN = 'Only a chat’s own turn can start sub-chats.';

const STARTED_NEXT =
  'The sub-chats work under their own modes. Spark sends this chat a report when each one’s task ends and one wrap-up when all have ended. Do not poll or wait; tell the user what started and end your turn.';

type Pieces = z.infer<typeof subChatPieceSchema>[];

async function parentOf(context: SparkToolContext): Promise<{ id: string; title: string }> {
  const { db } = context.deps;
  const { conversationId, runId } = context.scope;
  if (!conversationId || !runId) throw new SparkToolError(ONLY_A_CHAT_TURN);
  const { rows } = await db.query<{ title: string; sub_chat: boolean; top: boolean }>(
    `SELECT c.title, r.parent_run_id IS NULL AS top,
       EXISTS (SELECT 1 FROM sub_chats s WHERE s.conversation_id = c.id) AS sub_chat
     FROM conversations c JOIN runs r ON r.conversation_id = c.id
     WHERE c.id = $1 AND r.id = $2`,
    [conversationId, runId],
  );
  const row = rows[0];
  if (!row?.top) throw new SparkToolError(ONLY_A_CHAT_TURN);
  if (row.sub_chat) throw new SparkToolError(SUB_CHAT_CANNOT_BE_PARENT);
  if (await turnStart(db, runId)) throw new SparkToolError(NOT_FROM_ANOTHER_CHAT);
  return { id: conversationId, title: row.title };
}

async function planned(context: SparkToolContext, pieces: Pieces): Promise<StartSubChatsAction> {
  const parent = await parentOf(context);
  const facts = await planFacts(context.deps.db, context.scope.workspaceId, parent.id).catch(
    (error: unknown) => {
      if (error instanceof PlanFactsError) throw new SparkToolError(error.message);
      throw error;
    },
  );
  const plan = planSubChats(
    pieces.map((piece) => ({ ...piece, task: storableText(redactText(piece.task)) })),
    facts,
  );
  if (plan.kind === 'refusal') throw new SparkToolError(plan.message);
  return { action: 'start_sub_chats', parent, pieces: plan.pieces };
}

function pieceLines(action: StartSubChatsAction) {
  return action.pieces.map((piece) => ({
    title: piece.title,
    chat: piece.conversationId,
    project: piece.project.name,
    agent: piece.provider,
    model: piece.model,
    effort: piece.effort,
    mode: piece.agentMode,
    starts: subChatPlacement(piece, action.pieces),
  }));
}

async function start(context: SparkToolContext, pieces: Pieces) {
  const action = await planned(context, pieces);
  const { db } = context.deps;
  const run = actionRun(context.scope);
  const refusal = await deviceRefusal(db, context.scope.workspaceId, run.runId, action);
  if (refusal) {
    auditAction(run, action, { outcome: 'refused', reason: refusal });
    throw new SparkToolError(refusal);
  }
  const result = await proposeAction(context, action, { sendsTo: null, declineName: 'Discard' });
  return {
    pieces: pieceLines(action),
    ...result,
    ...(result.outcome === 'done' ? { next: STARTED_NEXT } : {}),
  };
}

export const subChatsTool = sparkTool({
  name: 'spark_sub_chats',
  title: 'Start sub-chats',
  needs: 'sub_chats',
  acts: true,
  description:
    'Split this job into sub-chats: each is its own chat with its own worktree, branch and pull request, nested under this one. Use it only for parts that ship separately, or when the user says to split. Each copies this chat’s agent, model, effort, mode and autonomy unless you set them; a mode never above yours. The task is your text, never the user’s. Runs at once or after one card, by this session’s mode. Reports and a wrap-up come back as messages; don’t poll.',
  input: {
    pieces: z
      .array(
        subChatPieceSchema.extend({
          stackedOn: subChatPieceSchema.shape.stackedOn.describe(
            'Title of the piece whose branch this one builds on.',
          ),
          startsAfter: subChatPieceSchema.shape.startsAfter.describe(
            'Titles of pieces to wait for.',
          ),
        }),
      )
      .min(1),
  },
  run: (args, context) => start(context, args.pieces),
});
