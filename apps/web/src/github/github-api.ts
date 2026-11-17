import {
  githubInboxSchema,
  type GithubInbox,
  type GithubInboxSeenRequest,
  type GithubInboxWindowDays,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

export const githubKeys = {
  inbox: ['github', 'inbox'] as const,
};

export const githubApi = {
  inbox: (refresh = false): Promise<GithubInbox> =>
    request(githubInboxSchema, refresh ? '/github/inbox?refresh=1' : '/github/inbox'),
  seen: (body: GithubInboxSeenRequest): Promise<GithubInbox> =>
    request(githubInboxSchema, '/github/inbox/seen', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  window: (windowDays: GithubInboxWindowDays): Promise<GithubInbox> =>
    request(githubInboxSchema, '/github/inbox/window', {
      method: 'PUT',
      body: JSON.stringify({ windowDays }),
    }),
};
