import {
  builderChatSchema,
  crewDraftsSchema,
  currentBuilderChatSchema,
  type BuilderChat,
  type CrewDraft,
} from '@spark-outpost/contracts';
import { request } from '../api/client.ts';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

function builderQuery(id: string | null, sparkId: string | null): string {
  if (id) return `?id=${id}`;
  return sparkId ? `?spark=${sparkId}` : '';
}

export const builderKeys = {
  current: (id: string | null, sparkId: string | null = null) =>
    ['crew-builder', id, sparkId] as const,
  drafts: ['crew-drafts'] as const,
};

export const builderApi = {
  current: async (id: string | null, sparkId: string | null): Promise<BuilderChat | null> =>
    (await request(currentBuilderChatSchema, `/crew/builder${builderQuery(id, sparkId)}`)).chat,
  start: (id: string, sparkId: string | null): Promise<BuilderChat> =>
    request(builderChatSchema, '/crew/builder', post(sparkId ? { id, sparkId } : { id })),
  done: (id: string): Promise<BuilderChat> =>
    request(builderChatSchema, `/crew/builder/${id}/done`, post({})),
  drafts: async (): Promise<CrewDraft[]> =>
    (await request(crewDraftsSchema, '/crew/drafts')).drafts,
};
