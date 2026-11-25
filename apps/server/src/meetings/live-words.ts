import { meetingLiveWordsSchema, type MeetingLiveWords } from '@spark-outpost/contracts';

export type WordsListener = (words: MeetingLiveWords) => void;

export interface LiveWords {
  begin(meetingId: string): void;
  push(meetingId: string, words: MeetingLiveWords): void;
  watch(meetingId: string, listener: WordsListener, onEnd: () => void): () => void;
  watchers(meetingId: string): number;
  end(meetingId: string): void;
}

interface Watcher {
  listener: WordsListener;
  onEnd: () => void;
}

export function createLiveWords(): LiveWords {
  const meetings = new Map<string, Set<Watcher>>();

  return {
    begin(meetingId) {
      if (!meetings.has(meetingId)) meetings.set(meetingId, new Set());
    },

    push(meetingId, words) {
      const watchers = meetings.get(meetingId);
      const parsed = meetingLiveWordsSchema.safeParse(words);
      if (!watchers || !parsed.success) return;
      for (const watcher of watchers) watcher.listener(parsed.data);
    },

    watch(meetingId, listener, onEnd) {
      const watchers = meetings.get(meetingId);
      if (!watchers) {
        onEnd();
        return () => undefined;
      }
      const watcher: Watcher = { listener, onEnd };
      watchers.add(watcher);
      return () => {
        watchers.delete(watcher);
      };
    },

    watchers: (meetingId) => meetings.get(meetingId)?.size ?? 0,

    end(meetingId) {
      const watchers = meetings.get(meetingId);
      if (!watchers) return;
      meetings.delete(meetingId);
      for (const watcher of watchers) watcher.onEnd();
    },
  };
}
