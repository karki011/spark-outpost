import { z } from 'zod';
import { parseAddress, SPARK_TEXT_MAX } from '@spark-outpost/contracts';
import { postToOutpost } from '../../outposts/post-service.ts';
import { requestAuditParams } from '../../outposts/request-audit.ts';
import { getPost } from '../../persistence/outpost-posts.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';
import { asToolError, memberTurn } from './outpost-turn.ts';

export const OUTPOST_NOTE_METHOD = 'spark/outpost_note';
export const NOTE_IS_ADDRESSED =
  'A note is addressed to no one, so it cannot start with a handle. Use spark_outpost_ask to ask a chat, or write the note without the leading @.';

async function note(context: SparkToolContext, args: { text: string }) {
  const { deps, scope } = context;
  const turn = await memberTurn(context);
  const handles = turn.outpost.members.map((member) => member.handle);
  if (parseAddress(args.text, handles).kind !== 'note') {
    throw new SparkToolError(NOTE_IS_ADDRESSED);
  }
  const [post] = await asToolError(
    postToOutpost(
      { db: deps.db, workspaceId: scope.workspaceId },
      { outpostId: turn.outpost.id, author: turn.author, text: args.text },
    ),
  );
  const stored = post ? await getPost(deps.db, post.id) : null;
  if (!stored) throw new SparkToolError('The note was not stored.');
  scope.actions?.audit?.message('harness', {
    method: OUTPOST_NOTE_METHOD,
    params: requestAuditParams(stored),
  });
  return {
    post: stored.post.id,
    message: 'Posted. The other chats read it at the start of their next turn; it starts no work.',
  };
}

export const outpostNoteTool = sparkTool({
  name: 'spark_outpost_note',
  title: 'Leave a note in the outpost',
  needs: 'outpost',
  description:
    "Post a note in this chat's outpost: a decision, a contract or a heads-up the other chats should know. It is addressed to no one and starts no work; each chat reads it at the start of its next turn, as data, and the user sees it in the outpost. To get an answer, use spark_outpost_ask instead.",
  input: { text: z.string().trim().min(1).max(SPARK_TEXT_MAX) },
  run: (args, context) => note(context, args),
});
