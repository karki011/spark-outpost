import { z } from 'zod';
import {
  remoteSparkListSchema,
  remoteSparkSchema,
  type AddRemoteSparkRequest,
  type RemoteSpark,
  type RemoteSparkList,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const remoteSparkKeys = {
  all: ['remote-sparks'] as const,
};

export const remoteSparksApi = {
  list: (): Promise<RemoteSparkList> => request(remoteSparkListSchema, '/remote-sparks'),
  add: (body: AddRemoteSparkRequest): Promise<RemoteSpark> =>
    request(remoteSparkSchema, '/remote-sparks', { method: 'POST', body: JSON.stringify(body) }),
  rename: async (id: string, name: string): Promise<void> => {
    await request(z.unknown(), `/remote-sparks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  },
  remove: async (id: string): Promise<void> => {
    await request(z.unknown(), `/remote-sparks/${id}`, { method: 'DELETE' });
  },
  renameLocal: async (name: string | null): Promise<void> => {
    await request(z.unknown(), '/remote-sparks/local', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },
  setIcon: async (id: string, png: string): Promise<void> => {
    await request(z.unknown(), `/remote-sparks/${id}/icon`, {
      method: 'PUT',
      body: JSON.stringify({ png }),
    });
  },
  removeIcon: async (id: string): Promise<void> => {
    await request(z.unknown(), `/remote-sparks/${id}/icon`, { method: 'DELETE' });
  },
  open: async (id: string): Promise<void> => {
    await request(z.unknown(), `/remote-sparks/${id}/open`, { method: 'POST', body: '{}' });
  },
};
