import { z } from 'zod';
import { redactText } from '../../audit/redact.ts';
import type { Queryable } from '../../persistence/db.ts';
import type { GitHubDeps } from '../../ship/github/access.ts';
import { repoPath } from '../../ship/github/connection.ts';
import { postRefusal, type PostGrant, type PostRequest } from './decide.ts';
import { connectionForPull, readPullBasics } from './material.ts';
import { recordPost } from './queue.ts';
import { reviewSettings } from './settings.ts';
import { reviewForRun, type RunReview } from './views.ts';

export const HEAD_MOVED =
  'The pull request has a newer commit than the one reviewed, so it was not approved. Spark reviews the new commit separately.';

export class PostRefusedError extends Error {}

export interface PostInput extends PostRequest {
  body: string;
}

export interface Posted {
  pull: string;
  kind: 'comment' | 'approve';
  action: string;
  url: string | null;
}

const postedSchema = z.object({ id: z.number(), html_url: z.string().optional() });

export async function postGrant(
  db: Queryable,
  runId: string | null,
): Promise<{ review: RunReview; grant: PostGrant } | null> {
  if (!runId) return null;
  const review = await reviewForRun(db, runId);
  if (!review) return null;
  const settings = await reviewSettings(db, review.workspaceId);
  return {
    review,
    grant: {
      pull: review.pull,
      state: review.state,
      stopping: review.stopping,
      mayPost: settings.mayPost,
      mayApprove: settings.mayPost && settings.mayApprove,
    },
  };
}

export async function postForReview(
  github: GitHubDeps,
  runId: string | null,
  input: PostInput,
): Promise<Posted> {
  const found = await postGrant(github.db, runId);
  const refusal = postRefusal(input, found?.grant ?? null);
  if (refusal || !found) throw new PostRefusedError(refusal ?? 'Not a review run.');
  const { review } = found;
  const { connection, linked } = await connectionForPull(github, review.pull);
  const pull = `${repoPath(linked.repo)}/pulls/${linked.number}`;
  const body = redactText(input.body);
  if (input.action === 'reply') {
    const reply = await connection.post(
      `${pull}/comments/${input.replyTo}/replies`,
      { body },
      postedSchema,
      'replying on a review thread',
    );
    const url = reply.html_url ?? null;
    await recordPost(github.db, review.id, { kind: 'comment', githubId: String(reply.id), url });
    return { pull: review.pull, kind: 'comment', action: 'reply', url };
  }
  const kind = input.action === 'approve' ? 'approve' : 'comment';
  if (kind === 'approve') {
    const current = await readPullBasics(connection, linked);
    if (current.head.sha !== review.headSha) throw new PostRefusedError(HEAD_MOVED);
  }
  const posted = await connection.post(
    `${pull}/reviews`,
    { commit_id: review.headSha, body, event: kind === 'approve' ? 'APPROVE' : 'COMMENT' },
    postedSchema,
    kind === 'approve' ? 'approving the pull request' : 'posting a review comment',
  );
  const url = posted.html_url ?? null;
  await recordPost(github.db, review.id, { kind, githubId: String(posted.id), url });
  return { pull: review.pull, kind, action: input.action, url };
}
