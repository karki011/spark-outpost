import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  MEETING_EVENT_KEYS_MAX,
  type MeetingDetail,
  type MeetingPatch,
  type StartMeetingRequest,
} from '@spark-outpost/contracts';
import { classifyFile, uploadAttachment } from '../api/attachments.ts';
import { meetingKeys } from './meeting-keys.ts';
import { meetingsApi } from './meetings-api.ts';

const SEARCH_DEBOUNCE_MS = 250;

function useDebounced(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function useMeetingStatus() {
  return useQuery({ queryKey: meetingKeys.status, queryFn: meetingsApi.status });
}

export function useMeetingList(query: string) {
  const search = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const list = useInfiniteQuery({
    queryKey: meetingKeys.list(search),
    queryFn: ({ pageParam }) => meetingsApi.list(search, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextBefore ?? undefined,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  return { ...list, items, search, searching: query.trim() !== search };
}

export function useMeeting(id: string) {
  return useQuery({ queryKey: meetingKeys.detail(id), queryFn: () => meetingsApi.detail(id) });
}

export function useMeetingsForEvents(eventKeys: readonly string[]) {
  const keys = [...new Set(eventKeys)].sort().slice(0, MEETING_EVENT_KEYS_MAX);
  return useQuery({
    queryKey: meetingKeys.forEvents(keys),
    queryFn: () => meetingsApi.forEvents(keys),
    enabled: keys.length > 0,
  });
}

function remember(client: QueryClient, detail: MeetingDetail) {
  client.setQueryData(meetingKeys.detail(detail.meeting.id), detail);
  void client.invalidateQueries({ queryKey: meetingKeys.lists });
  void client.invalidateQueries({ queryKey: meetingKeys.status });
}

export function useStartMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (request: StartMeetingRequest) => meetingsApi.start(request),
    onSuccess: (detail) => remember(client, detail),
  });
}

export function useStopMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meetingsApi.stop(id),
    onSuccess: (detail) => remember(client, detail),
  });
}

export function usePatchMeeting(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: MeetingPatch) => meetingsApi.patch(id, patch),
    onSuccess: (detail) => remember(client, detail),
  });
}

export function useDeleteMeeting() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => meetingsApi.remove(id),
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: meetingKeys.detail(id) });
      client.removeQueries({ queryKey: meetingKeys.lines(id) });
      void client.invalidateQueries({ queryKey: meetingKeys.all });
    },
  });
}

export function useSaveNotes(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (markdown: string) => meetingsApi.saveNotes(id, markdown),
    onSuccess: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

export function useWriteNotes(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => meetingsApi.writeNotes(id),
    onSuccess: () => client.invalidateQueries({ queryKey: meetingKeys.all }),
  });
}

export function useAttachFiles(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const classified = classifyFile(file);
      if ('error' in classified) throw new Error(classified.error);
      const attachment = await uploadAttachment(file, { mediaType: classified.mediaType });
      return meetingsApi.attach(id, attachment.id);
    },
    onSuccess: (detail) => remember(client, detail),
  });
}

export function useDetachFile(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => meetingsApi.detach(id, attachmentId),
    onSuccess: (detail) => remember(client, detail),
  });
}
