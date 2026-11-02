import { z } from 'zod';
import {
  userPluginsResponseSchema,
  type UserPluginsResponse,
  type UserPluginUpdate,
} from '@spark-outpost/contracts';
import { request } from './client.ts';

export const userPluginsKey = ['user-plugins'] as const;

export const userPluginsApi = {
  list: (): Promise<UserPluginsResponse> => request(userPluginsResponseSchema, '/user-plugins'),
  set: (key: string, change: UserPluginUpdate): Promise<unknown> =>
    request(z.unknown(), `/user-plugins/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(change),
    }),
  review: (key: string): Promise<UserPluginsResponse> =>
    request(userPluginsResponseSchema, `/user-plugins/${encodeURIComponent(key)}/review`, {
      method: 'POST',
    }),
};
