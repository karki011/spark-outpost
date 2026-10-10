import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  parseAddress,
  startMemberChatId,
  type CreateOutpostRequest,
  type MemberRequest,
  type Outpost,
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
    fromSpark: false,
    fromConversationId: null,
    fromRunId: null,
    fromHandle: null,
    userStarted: false,
    held: false,
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
    exchanges: [],
    files: 0,
    intro: null,
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

function keep(client: QueryClient, detail: OutpostDetail): void {
  const { outpost } = detail;
  client.setQueryData(outpostKeys.detail(outpost.id), detail);
  client.setQueryData<Outpost[]>(outpostKeys.list, (list) => {
    if (!list) return list;
    if (!list.some((listed) => listed.id === outpost.id)) return [...list, outpost];
    return list.map((listed) => (listed.id === outpost.id ? outpost : listed));
  });
}

function forget(client: QueryClient, id: string): void {
  client.removeQueries({ queryKey: outpostKeys.detail(id), exact: true });
  client.setQueryData<Outpost[]>(outpostKeys.list, (list) =>
    list?.filter((listed) => listed.id !== id),
  );
}

function refreshOutposts(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: outpostKeys.all });
}

function refreshChats(client: QueryClient, conversationIds: readonly string[]): Promise<unknown> {
  return Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.conversations, exact: true }),
    ...conversationIds.map((id) =>
      client.invalidateQueries({ queryKey: queryKeys.conversation(id), exact: true }),
    ),
  ]);
}

function memberIds(client: QueryClient, id: string): string[] {
  const detail = client.getQueryData<OutpostDetail>(outpostKeys.detail(id));
  return detail?.outpost.members.map((member) => member.conversationId) ?? [];
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
    onSuccess: (detail) => keep(client, detail),
    onError: (_error, input) => {
      client.setQueryData<OutpostDetail>(key, (detail) =>
        detail ? withoutPost(detail, input.id) : detail,
      );
      return client.invalidateQueries({ queryKey: key });
    },
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
    onSuccess: (detail) => keep(client, detail),
    onError: () => client.invalidateQueries({ queryKey: outpostKeys.detail(id) }),
  });
}

export function useStartNow(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (postId: string) => outpostsApi.startNow(id, postId),
    onSuccess: (detail) => keep(client, detail),
    onError: () => client.invalidateQueries({ queryKey: outpostKeys.detail(id) }),
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
    onSuccess: (detail) => keep(client, detail),
    onError: () => refreshOutposts(client),
  });
}

export function useCreateOutpost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateOutpostRequest) => outpostsApi.create(body),
    onSuccess: ({ outpost, posts, stories }) => keep(client, { outpost, posts, stories }),
    onSettled: (_detail, _error, body) => refreshChats(client, body.members.map(startMemberChatId)),
  });
}

async function applyChanges(id: string, changes: SheetChanges): Promise<OutpostDetail | null> {
  let latest: OutpostDetail | null = null;
  if (changes.name !== null) latest = await outpostsApi.update(id, { name: changes.name });
  for (const conversationId of changes.remove) {
    latest = await outpostsApi.removeMember(id, conversationId);
  }
  for (const member of changes.put) latest = await outpostsApi.putMember(id, member);
  return latest;
}

export function useSaveOutpost(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (changes: SheetChanges) => applyChanges(id, changes),
    onSuccess: (detail) => {
      if (detail) keep(client, detail);
    },
    onError: () => refreshOutposts(client),
    onSettled: (_detail, _error, changes) =>
      refreshChats(client, [
        ...changes.remove,
        ...changes.put.map((member) => member.conversationId),
      ]),
  });
}

export function useAddMember() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { outpostId: string; member: MemberRequest }) =>
      outpostsApi.putMember(input.outpostId, input.member),
    onSuccess: (detail) => keep(client, detail),
    onSettled: (_detail, _error, input) => refreshChats(client, [input.member.conversationId]),
  });
}

export function useDeleteOutpost(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => outpostsApi.remove(id),
    onSuccess: () => {
      const members = memberIds(client, id);
      forget(client, id);
      return refreshChats(client, members);
    },
  });
}
