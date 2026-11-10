import { z } from 'zod';
import {
  createOutpostResponseSchema,
  startDraftResponseSchema,
  outpostDraftSchema,
  outpostDetailSchema,
  outpostLibrarySchema,
  outpostSuggestionsSchema,
  outpostSchema,
  type CreateOutpostRequest,
  type CreateOutpostResponse,
  type CreatePostRequest,
  type MemberRequest,
  type Outpost,
  type OutpostDetail,
  type OutpostLibraryChats,
  type OutpostSuggestions,
  type StartDraftResponse,
  type UpdateOutpostRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const outpostKeys = {
  all: ['outposts'] as const,
  list: ['outposts', 'list'] as const,
  detail: (id: string) => ['outposts', 'detail', id] as const,
  drafts: ['outposts', 'draft'] as const,
  draft: (id: string) => ['outposts', 'draft', id] as const,
  suggestions: (id: string) => ['outposts', 'draft', 'suggested', id] as const,
  library: (id: string, signal: string) => ['outposts', 'library', id, signal] as const,
};

export const proposedDraftSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid().nullable(),
  outpostId: z.uuid().nullable(),
  body: outpostDraftSchema,
  startedAt: z.string().nullable(),
});
export type ProposedDraft = z.infer<typeof proposedDraftSchema>;

const outpostPaths = {
  list: '/outposts',
  one: (id: string) => `/outposts/${id}`,
  instructions: (id: string) => `/outposts/${id}/instructions`,
  member: (id: string, conversationId: string) => `/outposts/${id}/members/${conversationId}`,
  posts: (id: string) => `/outposts/${id}/posts`,
  cancelPost: (id: string, postId: string) => `/outposts/${id}/posts/${postId}/cancel`,
  startNow: (id: string, postId: string) => `/outposts/${id}/posts/${postId}/start-now`,
  draft: (id: string) => `/outposts/drafts/${id}`,
  suggestions: (id: string) => `/outposts/${id}/suggestions`,
  library: (id: string) => `/outposts/${id}/library`,
  startDraft: (id: string) => `/outposts/drafts/${id}/start`,
};

function changed(path: string, init: RequestInit): Promise<OutpostDetail> {
  return request(outpostDetailSchema, path, init);
}

export const outpostsApi = {
  list: (): Promise<Outpost[]> => request(z.array(outpostSchema), outpostPaths.list),
  get: (id: string): Promise<OutpostDetail> => request(outpostDetailSchema, outpostPaths.one(id)),
  suggestions: (id: string): Promise<OutpostSuggestions> =>
    request(outpostSuggestionsSchema, outpostPaths.suggestions(id)),
  library: (id: string): Promise<OutpostLibraryChats> =>
    request(outpostLibrarySchema, outpostPaths.library(id)),
  create: (body: CreateOutpostRequest): Promise<CreateOutpostResponse> =>
    request(createOutpostResponseSchema, outpostPaths.list, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpdateOutpostRequest): Promise<OutpostDetail> =>
    changed(outpostPaths.one(id), { method: 'PATCH', body: JSON.stringify(body) }),
  setInstructions: (id: string, instructions: string): Promise<OutpostDetail> =>
    changed(outpostPaths.instructions(id), {
      method: 'PUT',
      body: JSON.stringify({ instructions }),
    }),
  remove: (id: string): Promise<null> =>
    request(z.null(), outpostPaths.one(id), { method: 'DELETE' }),
  putMember: (id: string, member: MemberRequest): Promise<OutpostDetail> =>
    changed(outpostPaths.member(id, member.conversationId), {
      method: 'PUT',
      body: JSON.stringify({ handle: member.handle }),
    }),
  removeMember: (id: string, conversationId: string): Promise<OutpostDetail> =>
    changed(outpostPaths.member(id, conversationId), { method: 'DELETE' }),
  post: (id: string, body: CreatePostRequest): Promise<OutpostDetail> =>
    changed(outpostPaths.posts(id), { method: 'POST', body: JSON.stringify(body) }),
  cancelPost: (id: string, postId: string): Promise<OutpostDetail> =>
    changed(outpostPaths.cancelPost(id, postId), { method: 'POST', body: '{}' }),
  startNow: (id: string, postId: string): Promise<OutpostDetail> =>
    changed(outpostPaths.startNow(id, postId), { method: 'POST', body: '{}' }),
  getDraft: (id: string): Promise<ProposedDraft> =>
    request(proposedDraftSchema, outpostPaths.draft(id)),
  startDraft: (id: string): Promise<StartDraftResponse> =>
    request(startDraftResponseSchema, outpostPaths.startDraft(id), { method: 'POST', body: '{}' }),
};
