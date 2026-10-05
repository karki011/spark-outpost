import { z } from 'zod';
import {
  savedSignInSchema,
  signInListSchema,
  type CreateSignInRequest,
  type SavedSignIn,
  type UpdateSignInRequest,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const signInKeys = {
  project: (projectId: string) => ['sign-ins', projectId] as const,
};

const path = (projectId: string, id = '') => `/projects/${projectId}/sign-ins${id ? `/${id}` : ''}`;

export const signInsApi = {
  list: async (projectId: string): Promise<SavedSignIn[]> =>
    (await request(signInListSchema, path(projectId))).signIns,
  create: (projectId: string, body: CreateSignInRequest): Promise<SavedSignIn> =>
    request(savedSignInSchema, path(projectId), { method: 'POST', body: JSON.stringify(body) }),
  update: (projectId: string, id: string, body: UpdateSignInRequest): Promise<SavedSignIn> =>
    request(savedSignInSchema, path(projectId, id), { method: 'PUT', body: JSON.stringify(body) }),
  remove: (projectId: string, id: string): Promise<null> =>
    request(z.null(), path(projectId, id), { method: 'DELETE' }),
};
