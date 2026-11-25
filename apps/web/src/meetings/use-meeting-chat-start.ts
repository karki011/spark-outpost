import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { invalidateChatDetail } from '../api/chat-detail.ts';
import { api } from '../api/client.ts';
import { markMeetingChatStarted, meetingChatStart, meetingChatStarted } from './meeting-ask.ts';
import { meetingKeys } from './meeting-keys.ts';
import { meetingsApi } from './meetings-api.ts';

export function useMeetingChatStart(
  meetingId: string,
  chatId: string,
  detail: ConversationDetail | undefined,
): boolean {
  const queryClient = useQueryClient();
  const [done, setDone] = useState(() => meetingChatStarted(meetingId));
  const working = useRef(false);
  const untouched = detail ? detail.messages.length === 0 && detail.runs.length === 0 : null;

  useEffect(() => {
    if (done || untouched === null || working.current) return;
    if (!untouched) {
      markMeetingChatStarted(meetingId);
      return;
    }
    working.current = true;
    const apply = async () => {
      const view = await queryClient.fetchQuery({
        queryKey: meetingKeys.model,
        queryFn: meetingsApi.model,
        staleTime: 0,
      });
      const start = meetingChatStart(view);
      if (start) {
        await api.updateChatSettings(chatId, start);
        await invalidateChatDetail(queryClient, chatId);
      }
      markMeetingChatStarted(meetingId);
    };
    void apply()
      .catch(() => undefined)
      .finally(() => setDone(true));
  }, [done, untouched, meetingId, chatId, queryClient]);

  return done || untouched === false;
}
