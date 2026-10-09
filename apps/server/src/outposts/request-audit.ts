import { createHash } from 'node:crypto';
import { insertProtocolEntries } from '../persistence/audit-log.ts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { getPost } from '../persistence/outpost-posts.ts';
import { createAuditRecorder } from '../workflow/audit-recorder.ts';
import type { RunInput } from '../workflow/run-input.ts';
import type { PostWithFacts } from './ports.ts';
import { toOutpostPost } from './post-view.ts';

export const OUTPOST_REQUEST_METHOD = 'spark/outpost_request';

export function requestAuditParams(found: PostWithFacts): Record<string, unknown> {
  const { post } = found;
  return {
    postId: post.id,
    taskId: post.taskId,
    outpostId: post.outpostId,
    fromUser: post.fromUser,
    fromConversationId: post.fromConversationId,
    toConversationId: post.toConversationId,
    state: toOutpostPost(found, null).state,
    textLength: post.body.length,
    textSha256: createHash('sha256').update(post.body).digest('hex'),
  };
}

export async function auditOutpostRequest(
  db: Db,
  lease: Lease,
  input: Pick<RunInput, 'outpostRequest' | 'parentRunId'>,
): Promise<void> {
  const request = input.outpostRequest;
  if (!request || input.parentRunId !== null) return;
  const found = await getPost(db, request.postId);
  if (!found) return;
  const audit = createAuditRecorder({
    write: (entries) => insertProtocolEntries(db, lease, entries),
  });
  audit.message('harness', { method: OUTPOST_REQUEST_METHOD, params: requestAuditParams(found) });
  await audit.close();
}
