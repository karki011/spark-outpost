import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createOutpostRequestSchema,
  createPostRequestSchema,
  needsYouCount,
  stackedCount,
  updateOutpostRequestSchema,
  type ChatDrafts,
  type CreateOutpostResponse,
  type Outpost,
  type OutpostDetail,
  type OutpostDraft,
  type OutpostPost,
} from '@spark-outpost/contracts';
import type { Db } from '../persistence/db.ts';
import { draftsOfChat, getDraft } from '../persistence/outpost-drafts.ts';
import { requestExchanges } from '../persistence/outpost-exchanges.ts';
import { requestAnswer } from '../persistence/outpost-answers.ts';
import { cancelUnsent, getPost, listPosts, releaseHold } from '../persistence/outpost-posts.ts';
import { storiesOf } from '../persistence/outpost-stories.ts';
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
import type { PeerAgent, PostWithFacts, StackGit, StoredOutpost } from '../outposts/ports.ts';
import { introViews } from '../outposts/intro-view.ts';
import { joinOutpost, leaveOutpost, postToOutpost } from '../outposts/post-service.ts';
import { toOutpostPost } from '../outposts/post-view.ts';
import { DRAFT_NOT_FOUND, startOutpost, type FolderExists } from '../outposts/start-outpost.ts';
import { toStories, UNKNOWN_STACK } from '../outposts/story-view.ts';
import { paramId, parseBody } from './validation.ts';

export const POST_NOT_FOUND = 'That post does not exist. It may have been deleted.';
export const ONLY_REQUESTS_CANCEL = 'Only a request can be cancelled.';
export const ONLY_REQUESTS_START = 'Only a request can be started.';
export const REQUEST_FINISHED = 'That request has already finished.';
export const CANCEL_UNAVAILABLE = 'That request could not be cancelled. Try again.';
export const NOT_A_MEMBER = 'That chat is not in this outpost.';

export interface OutpostRouteOptions {
  db: Db;
  workspaceId: string;
  peer: PeerAgent;
  drain(conversationId: string): Promise<unknown>;
  folderExists?: FolderExists;
  stackGit?: StackGit;
}

export interface DraftView {
  id: string;
  conversationId: string | null;
  outpostId: string | null;
  title: string;
  body: OutpostDraft;
  startedAt: string | null;
  createdAt: string;
}

const handleBodySchema = z.object({ handle: z.string() });

export function outpostErrorStatus(error: unknown): { status: number; message: string } | null {
  if (error instanceof OutpostError) return { status: error.status, message: error.message };
  return null;
}

function conversationParam(req: Request): string {
  return paramId(req, 'conversationId');
}

export function outpostRoutes(options: OutpostRouteOptions): Router {
  const { db, workspaceId, peer, drain, folderExists, stackGit = UNKNOWN_STACK } = options;
  const router = Router();
  const service = { db, workspaceId, ...(folderExists ? { folderExists } : {}) };

  const known = async (id: string): Promise<StoredOutpost> => {
    const outpost = await getOutpost(db, workspaceId, id);
    if (!outpost) throw new OutpostError(404, OUTPOST_NOT_FOUND);
    return outpost;
  };

  const detail = async (id: string): Promise<OutpostDetail> => {
    const outpost = await known(id);
    const found = await listPosts(db, id);
    const intros = await introViews(db, outpost, found);
    const posts: OutpostPost[] = [];
    for (const post of found) {
      const answer = await requestAnswer(db, workspaceId, post);
      const exchanges = await requestExchanges(db, post.post);
      posts.push(toOutpostPost(post, answer, intros.get(post.post.id), exchanges));
    }
    const stories = await toStories(await storiesOf(db, id), stackGit);
    return { outpost: { ...outpost, needsYou: needsYouCount(posts) }, posts, stories };
  };

  const counted = async (outpost: StoredOutpost): Promise<Outpost> => {
    const posts = (await listPosts(db, outpost.id)).map((post) => toOutpostPost(post, null));
    return { ...outpost, needsYou: needsYouCount(posts) };
  };

  const openRequest = async (
    outpostId: string,
    postId: string,
    onlyRequests: string,
  ): Promise<PostWithFacts> => {
    await known(outpostId);
    const found = await getPost(db, postId);
    if (!found || found.post.outpostId !== outpostId) throw new OutpostError(404, POST_NOT_FOUND);
    if (found.post.kind !== 'request') throw new OutpostError(409, onlyRequests);
    return found;
  };

  const cancelRequest = async (outpostId: string, postId: string): Promise<void> => {
    const found = await openRequest(outpostId, postId, ONLY_REQUESTS_CANCEL);
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
    const { created, failed } = await startOutpost(service, request);
    const response: CreateOutpostResponse = { ...(await detail(request.id)), failed };
    res.status(created ? 201 : 200).json(response);
  });

  router.get('/outposts/drafts/:id', async (req, res) => {
    const draft = await getDraft(db, workspaceId, paramId(req));
    if (!draft) throw new OutpostError(404, DRAFT_NOT_FOUND);
    const view: DraftView = {
      id: draft.id,
      conversationId: draft.conversationId,
      outpostId: draft.outpostId,
      title: draft.title,
      body: draft.body,
      startedAt: draft.startedAt,
      createdAt: draft.createdAt,
    };
    res.json(view);
  });

  router.get('/conversations/:id/outpost-drafts', async (req, res) => {
    const found = await draftsOfChat(db, workspaceId, paramId(req));
    const view: ChatDrafts = {
      drafts: found.map((draft) => ({
        id: draft.id,
        runId: draft.runId,
        chats: draft.body.chats.length,
        stacked: stackedCount(draft.body.chats),
        outpostId: draft.outpostId,
        startedAt: draft.startedAt,
      })),
    };
    res.json(view);
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
      ...(request.to ? { to: request.to } : {}),
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

  router.post('/outposts/:id/posts/:postId/start-now', async (req, res) => {
    const outpostId = paramId(req);
    const postId = paramId(req, 'postId');
    await openRequest(outpostId, postId, ONLY_REQUESTS_START);
    if (await releaseHold(db, postId)) await notifyOutpostChanged(db, outpostId);
    res.json(await detail(outpostId));
  });

  return router;
}
