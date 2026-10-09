import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  parseAddress,
  type CreateOutpostRequest,
  type MemberRequest,
  type OutpostDetail,
  type OutpostPost,
} from '@spark-outpost/contracts';
import { api, queryKeys } from '../api/client.ts';
import { outpostKeys, outpostsApi } from './outposts-api.ts';
import type { SheetChanges } from './sheet-draft.ts';

interface NewPost {
  id: string;
  text: string;
}

interface NewAnswer {
  conversationId: string;
  text: string;
}

export function optimisticPost(detail: OutpostDetail, input: NewPost, now: string): OutpostPost {
  const members = detail.outpost.members;
  const address = parseAddress(
    input.text,
    members.map((member) => member.handle),
  );
  const to = address.kind === 'request' ? address.to : null;
  const paused = detail.outpost.pausedAt !== null;
  return {
    id: input.id,
    outpostId: detail.outpost.id,
    kind: to ? 'request' : 'note',
    body: address.body,
    fromUser: true,
    fromConversationId: null,
    fromHandle: null,
    toConversationId: members.find((member) => member.handle === to)?.conversationId ?? null,
    toHandle: to,
    guest: false,
    waits: false,
    batchId: null,
    taskId: null,
    runId: null,
    pinnedAt: null,
    createdAt: now,
    state: to ? 'sent' : null,
    reason: to ? (paused ? 'Paused' : 'Not sent yet') : null,
    answer: null,
  };
}

function withPost(detail: OutpostDetail, post: OutpostPost): OutpostDetail {
  if (detail.posts.some((existing) => existing.id === post.id)) return detail;
  return { ...detail, posts: [...detail.posts, post] };
}

function withoutPost(detail: OutpostDetail, postId: string): OutpostDetail {
  return { ...detail, posts: detail.posts.filter((post) => post.id !== postId) };
}

function withPaused(detail: OutpostDetail, paused: boolean, now: string): OutpostDetail {
  return { ...detail, outpost: { ...detail.outpost, pausedAt: paused ? now : null } };
}

function refresh(client: QueryClient): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: outpostKeys.all }),
    client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
  ]);
}

export function useOutposts() {
  return useQuery({ queryKey: outpostKeys.list, queryFn: outpostsApi.list });
}

export function useOutpost(id: string) {
  return useQuery({ queryKey: outpostKeys.detail(id), queryFn: () => outpostsApi.get(id) });
}

export function usePost(id: string) {
  const client = useQueryClient();
  const key = outpostKeys.detail(id);
  return useMutation({
    mutationFn: (input: NewPost) => outpostsApi.post(id, input),
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const now = new Date().toISOString();
      client.setQueryData<OutpostDetail>(key, (detail) =>
        detail ? withPost(detail, optimisticPost(detail, input, now)) : detail,
      );
    },
    onError: (_error, input) => {
      client.setQueryData<OutpostDetail>(key, (detail) =>
        detail ? withoutPost(detail, input.id) : detail,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export function useAnswer(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewAnswer) =>
      api.sendMessage(input.conversationId, crypto.randomUUID(), input.text),
    onSettled: (_result, _error, input) =>
      Promise.all([
        client.invalidateQueries({ queryKey: outpostKeys.detail(id) }),
        client.invalidateQueries({ queryKey: queryKeys.conversation(input.conversationId) }),
      ]),
  });
}

export function useCancel(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => outpostsApi.cancelPost(id, postId),
    onSettled: () => client.invalidateQueries({ queryKey: outpostKeys.detail(id) }),
  });
}

export function usePause(id: string) {
  const client = useQueryClient();
  const key = outpostKeys.detail(id);
  return useMutation({
    mutationFn: (paused: boolean) => outpostsApi.update(id, { paused }),
    onMutate: async (paused) => {
      await client.cancelQueries({ queryKey: key });
      const now = new Date().toISOString();
      client.setQueryData<OutpostDetail>(key, (detail) =>
        detail ? withPaused(detail, paused, now) : detail,
      );
    },
    onSettled: () => client.invalidateQueries({ queryKey: outpostKeys.all }),
  });
}

export function useCreateOutpost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOutpostRequest) => outpostsApi.create(body),
    onSettled: () => refresh(client),
  });
}

async function applyChanges(id: string, changes: SheetChanges): Promise<void> {
  if (changes.name !== null) await outpostsApi.update(id, { name: changes.name });
  for (const conversationId of changes.remove) await outpostsApi.removeMember(id, conversationId);
  for (const member of changes.put) await outpostsApi.putMember(id, member);
}

export function useSaveOutpost(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: SheetChanges) => applyChanges(id, changes),
    onSettled: () => refresh(client),
  });
}

export function useAddMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { outpostId: string; member: MemberRequest }) =>
      outpostsApi.putMember(input.outpostId, input.member),
    onSettled: () => refresh(client),
  });
}

export function useDeleteOutpost(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => outpostsApi.remove(id),
    onSuccess: () => {
      client.removeQueries({ queryKey: outpostKeys.detail(id), exact: true });
      return refresh(client);
    },
  });
}
