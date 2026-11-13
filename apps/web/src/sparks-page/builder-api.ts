import {
  builderChatSchema,
  crewDraftsSchema,
  currentBuilderChatSchema,
  type BuilderChat,
  type CrewDraft,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const builderKeys = {
  current: ['crew-builder'] as const,
  drafts: ['crew-drafts'] as const,
};

export const builderApi = {
  current: async (): Promise<BuilderChat | null> =>
    (await request(currentBuilderChatSchema, '/crew/builder')).chat,
  start: (id: string): Promise<BuilderChat> =>
    request(builderChatSchema, '/crew/builder', post({ id })),
  done: (id: string): Promise<BuilderChat> =>
    request(builderChatSchema, `/crew/builder/${id}/done`, post({})),
  drafts: async (): Promise<CrewDraft[]> =>
    (await request(crewDraftsSchema, '/crew/drafts')).drafts,
};
