import { z } from 'zod';
import {
  createOutpostResponseSchema,
  outpostDetailSchema,
  outpostSchema,
  type CreateOutpostRequest,
  type CreateOutpostResponse,
  type CreatePostRequest,
  type MemberRequest,
  type Outpost,
  type OutpostDetail,
  type UpdateOutpostRequest,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const outpostKeys = {
  all: ['outposts'] as const,
  list: ['outposts', 'list'] as const,
  detail: (id: string) => ['outposts', 'detail', id] as const,
};

const outpostPaths = {
  list: '/outposts',
  one: (id: string) => `/outposts/${id}`,
  member: (id: string, conversationId: string) => `/outposts/${id}/members/${conversationId}`,
  posts: (id: string) => `/outposts/${id}/posts`,
  cancelPost: (id: string, postId: string) => `/outposts/${id}/posts/${postId}/cancel`,
};

function changed(path: string, init: RequestInit): Promise<OutpostDetail> {
  return request(outpostDetailSchema, path, init);
}

export const outpostsApi = {
  list: (): Promise<Outpost[]> => request(z.array(outpostSchema), outpostPaths.list),
  get: (id: string): Promise<OutpostDetail> => request(outpostDetailSchema, outpostPaths.one(id)),
  create: (body: CreateOutpostRequest): Promise<CreateOutpostResponse> =>
    request(createOutpostResponseSchema, outpostPaths.list, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: UpdateOutpostRequest): Promise<OutpostDetail> =>
    changed(outpostPaths.one(id), { method: 'PATCH', body: JSON.stringify(body) }),
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
};
