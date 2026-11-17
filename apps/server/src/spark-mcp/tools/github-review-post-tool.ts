import { z } from 'zod';
import { PostRefusedError, postForReview, type PostInput } from '../../github-inbox/review/post.ts';
import { POST_TOOL_NAME } from '../../github-inbox/review/prompt.ts';
import { gitHubDepsFor } from '../deps.ts';
import { sparkTool, SparkToolError, type SparkToolContext } from '../tool.ts';

function audit(context: SparkToolContext, input: PostInput, outcome: Record<string, unknown>) {
  context.scope.actions?.audit?.message('harness', {
    method: 'spark/github_review_post',
    params: {
      action: input.action,
      ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      ...outcome,
    },
  });
}

async function post(input: PostInput, context: SparkToolContext) {
  try {
    const posted = await postForReview(
      gitHubDepsFor(context.deps, context.scope),
      context.scope.runId,
      input,
    );
    audit(context, input, { outcome: 'posted', pull: posted.pull, url: posted.url });
    const observed = (await context.scope.observations?.labels()) ?? [];
    if (observed.length > 0) {
      context.scope.observations?.sentOut({
        toolCallId: context.callId ?? null,
        subject: `a ${posted.kind === 'approve' ? 'pull request approval' : 'review comment'} on ${posted.pull}`,
        target: 'GitHub',
        observed,
      });
    }
    return { outcome: 'posted', ...posted };
  } catch (error) {
    if (error instanceof PostRefusedError) {
      audit(context, input, { outcome: 'refused', reason: error.message });
      throw new SparkToolError(error.message);
    }
    throw error;
  }
}

export const githubReviewPostTool = sparkTool({
  name: POST_TOOL_NAME,
  acts: true,
  needs: 'github_review_post',
  title: 'Post on the reviewed pull request',
  description:
    'Only in a pull request review run Spark started, and only while the user allows posting: posts on the pull request under review, never another one. action comment posts a review comment on the reviewed commit; approve approves it (only when the user also allows approving, and only if no newer commit arrived); reply answers one of its review threads (replyTo: the review comment id from the material). Requesting changes, merging, pushing, dismissing and resolving are never possible. A post is a send off this computer.',
  input: {
    action: z.string().max(40).describe('comment, approve or reply.'),
    body: z.string().min(1).max(65_000).describe('Markdown text to post.'),
    replyTo: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('For reply: the id of a review comment on this pull request.'),
    pull: z
      .string()
      .max(300)
      .optional()
      .describe('The pull request (owner/repo#number). Defaults to the one under review.'),
  },
  run: (args, context) => post(args, context),
});
