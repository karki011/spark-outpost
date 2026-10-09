import { z } from 'zod';
import {
  outpostDetailSchema,
  outpostSchema,
  type CreateOutpostRequest,
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

const done = z.unknown();

export const outpostsApi = {
  list: (): Promise<Outpost[]> => request(z.array(outpostSchema), outpostPaths.list),
  get: (id: string): Promise<OutpostDetail> => request(outpostDetailSchema, outpostPaths.one(id)),
  create: (body: CreateOutpostRequest): Promise<unknown> =>
    request(done, outpostPaths.list, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: UpdateOutpostRequest): Promise<unknown> =>
    request(done, outpostPaths.one(id), { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string): Promise<unknown> =>
    request(done, outpostPaths.one(id), { method: 'DELETE', body: '{}' }),
  putMember: (id: string, member: MemberRequest): Promise<unknown> =>
    request(done, outpostPaths.member(id, member.conversationId), {
      method: 'PUT',
      body: JSON.stringify(member),
    }),
  removeMember: (id: string, conversationId: string): Promise<unknown> =>
    request(done, outpostPaths.member(id, conversationId), { method: 'DELETE', body: '{}' }),
  post: (id: string, body: CreatePostRequest): Promise<unknown> =>
    request(done, outpostPaths.posts(id), { method: 'POST', body: JSON.stringify(body) }),
  cancelPost: (id: string, postId: string): Promise<unknown> =>
    request(done, outpostPaths.cancelPost(id, postId), { method: 'POST', body: '{}' }),
};
