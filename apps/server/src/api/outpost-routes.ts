import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createOutpostRequestSchema,
  createPostRequestSchema,
  needsYouCount,
  updateOutpostRequestSchema,
  type Outpost,
  type OutpostDetail,
  type OutpostPost,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { cancelUnsent, getPost, listPosts, requestAnswer } from '../persistence/outpost-posts.ts';
import {
  deleteOutpost,
  getOutpost,
  listOutposts,
  notifyOutpostChanged,
  OUTPOST_NOT_FOUND,
  OutpostError,
  setName,
  setPaused,
} from '../persistence/outposts.ts';
import type { PeerAgent, PostWithFacts, StoredOutpost } from '../outposts/ports.ts';
import { joinOutpost, leaveOutpost, openOutpost, postToOutpost } from '../outposts/post-service.ts';
import { toOutpostPost } from '../outposts/post-view.ts';
import { paramId, parseBody } from './validation.ts';

export const POST_NOT_FOUND = 'That post does not exist. It may have been deleted.';
export const ONLY_REQUESTS_CANCEL = 'Only a request can be cancelled.';
export const REQUEST_FINISHED = 'That request has already finished.';
export const CANCEL_UNAVAILABLE = 'That request could not be cancelled. Try again.';
export const NOT_A_MEMBER = 'That chat is not in this outpost.';

export interface OutpostRouteOptions {
  db: Db;
  workspaceId: string;
  peer: PeerAgent;
  drain(conversationId: string): Promise<unknown>;
}

const handleBodySchema = z.object({ handle: z.string() });

export function outpostErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof OutpostError) return { status: error.status, message: error.message };
  return null;
}

function conversationParam(req: Request): string {
  return paramId(req, 'conversationId');
}

export function outpostRoutes({ db, workspaceId, peer, drain }: OutpostRouteOptions): Router {
  const router = Router();
  const service = { db, workspaceId };

  const known = async (id: string): Promise<StoredOutpost> => {
    const outpost = await getOutpost(db, workspaceId, id);
    if (!outpost) throw new OutpostError(404, OUTPOST_NOT_FOUND);
    return outpost;
  };

  const postViews = async (posts: PostWithFacts[], answers: boolean): Promise<OutpostPost[]> => {
    const views: OutpostPost[] = [];
    for (const found of posts) {
      const answer = answers ? await requestAnswer(db, workspaceId, found) : null;
      views.push(toOutpostPost(found, answer));
    }
    return views;
  };

  const detail = async (id: string): Promise<OutpostDetail> => {
    const outpost = await known(id);
    const posts = await postViews(await listPosts(db, id), true);
    return { outpost: { ...outpost, needsYou: needsYouCount(posts) }, posts };
  };

  const counted = async (outpost: StoredOutpost): Promise<Outpost> => {
    const posts = await postViews(await listPosts(db, outpost.id), false);
    return { ...outpost, needsYou: needsYouCount(posts) };
  };

  const openRequest = async (outpostId: string, postId: string): Promise<PostWithFacts> => {
    await known(outpostId);
    const found = await getPost(db, postId);
    if (!found || found.post.outpostId !== outpostId) throw new OutpostError(404, POST_NOT_FOUND);
    if (found.post.kind !== 'request') throw new OutpostError(409, ONLY_REQUESTS_CANCEL);
    return found;
  };

  const cancelRequest = async (outpostId: string, postId: string): Promise<void> => {
    const found = await openRequest(outpostId, postId);
    const { state } = toOutpostPost(found, null);
    if (state === 'cancelled') return;
    if (state === 'answered' || state === 'failed') throw new OutpostError(409, REQUEST_FINISHED);
    if (await cancelUnsent(db, postId)) return;
    const sent = (await getPost(db, postId))?.post;
    if (!sent?.taskId || !sent.toConversationId) throw new OutpostError(409, REQUEST_FINISHED);
    await peer
      .cancel({ taskId: sent.taskId, conversationId: sent.toConversationId })
      .catch((error: unknown) => {
        console.error(error);
        throw new OutpostError(503, CANCEL_UNAVAILABLE);
      });
  };

  const resume = async (outpost: StoredOutpost): Promise<void> => {
    await Promise.allSettled(outpost.members.map((member) => drain(member.conversationId)));
  };

  router.get('/outposts', async (_req, res) => {
    const outposts: Outpost[] = [];
    for (const outpost of await listOutposts(db, workspaceId))
      outposts.push(await counted(outpost));
    res.json(outposts);
  });

  router.post('/outposts', async (req, res) => {
    const request = parseBody(createOutpostRequestSchema, req);
    const { created } = await openOutpost(service, request);
    res.status(created ? 201 : 200).json(await detail(request.id));
  });

  router.get('/outposts/:id', async (req, res) => {
    res.json(await detail(paramId(req)));
  });

  router.patch('/outposts/:id', async (req, res) => {
    const id = paramId(req);
    const update = parseBody(updateOutpostRequestSchema, req);
    const before = await known(id);
    if (update.name !== undefined) await setName(db, workspaceId, id, update.name);
    if (update.paused !== undefined) await setPaused(db, workspaceId, id, update.paused);
    await notifyOutpostChanged(db, id);
    if (update.paused === false && before.pausedAt !== null) await resume(before);
    res.json(await detail(id));
  });

  router.delete('/outposts/:id', async (req, res) => {
    const id = paramId(req);
    if (!(await deleteOutpost(db, workspaceId, id))) throw new OutpostError(404, OUTPOST_NOT_FOUND);
    await notifyOutpostChanged(db, id);
    res.status(204).end();
  });

  router.put('/outposts/:id/members/:conversationId', async (req, res) => {
    const outpostId = paramId(req);
    const conversationId = conversationParam(req);
    const { handle } = parseBody(handleBodySchema, req);
    await joinOutpost(service, { outpostId, conversationId, handle });
    res.json(await detail(outpostId));
  });

  router.delete('/outposts/:id/members/:conversationId', async (req, res) => {
    const outpostId = paramId(req);
    const removed = await leaveOutpost(service, {
      outpostId,
      conversationId: conversationParam(req),
    });
    if (!removed) throw new OutpostError(404, NOT_A_MEMBER);
    res.json(await detail(outpostId));
  });

  router.post('/outposts/:id/posts', async (req, res) => {
    const outpostId = paramId(req);
    const request = parseBody(createPostRequestSchema, req);
    await postToOutpost(service, {
      outpostId,
      author: { kind: 'user' },
      id: request.id,
      text: request.text,
      ...(request.guestConversationId ? { guestConversationId: request.guestConversationId } : {}),
    });
    res.status(201).json(await detail(outpostId));
  });

  router.post('/outposts/:id/posts/:postId/cancel', async (req, res) => {
    const outpostId = paramId(req);
    const postId = paramId(req, 'postId');
    await cancelRequest(outpostId, postId);
    await notifyOutpostChanged(db, outpostId);
    res.json(await detail(outpostId));
  });

  return router;
}
