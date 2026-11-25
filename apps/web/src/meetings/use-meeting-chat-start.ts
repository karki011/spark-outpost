import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@spark-outpost/contracts';
import { invalidateChatDetail } from '../api/chat-detail.ts';
import { api } from '../api/client.ts';
import { markMeetingChatStarted, meetingChatStart, meetingChatStarted } from './meeting-ask.ts';
import { meetingKeys } from './meeting-keys.ts';
import { meetingsApi } from './meetings-api.ts';

export interface MeetingChatStart {
  ready: boolean;
  ensure: () => Promise<void>;
}

export function useMeetingChatStart(
  meetingId: string,
  chatId: string,
  detail: ConversationDetail | undefined,
): MeetingChatStart {
  const queryClient = useQueryClient();
  const [tried, setTried] = useState(() => meetingChatStarted(meetingId));
  const working = useRef<Promise<void> | null>(null);
  const untouched = detail ? detail.messages.length === 0 && detail.runs.length === 0 : null;

  const ensure = useCallback((): Promise<void> => {
    if (meetingChatStarted(meetingId)) return Promise.resolve();
    if (working.current) return working.current;
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
    const attempt = apply().finally(() => {
      working.current = null;
    });
    working.current = attempt;
    return attempt;
  }, [meetingId, chatId, queryClient]);

  useEffect(() => {
    if (tried || untouched === null) return;
    if (!untouched) {
      markMeetingChatStarted(meetingId);
      return;
    }
    void ensure()
      .catch(() => undefined)
      .finally(() => setTried(true));
  }, [tried, untouched, meetingId, ensure]);

  return { ready: tried || untouched === false, ensure };
}
