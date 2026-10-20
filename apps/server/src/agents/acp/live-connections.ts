import type { LiveSessions } from '../../providers/provider.ts';
import type { LiveConnection } from './live-connection.ts';

export const LIVE_IDLE_MS = 30 * 60_000;

export function liveIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  const shortened = Number(env.SPARK_TEST_LIVE_SESSION_IDLE_MS);
  return Number.isInteger(shortened) && shortened > 0 ? shortened : LIVE_IDLE_MS;
}

export interface LivePool extends LiveSessions {
  get(conversationId: string): LiveConnection | null;
  keep(conversationId: string, connection: LiveConnection): void;
  closeSession(sessionId: string): Promise<void>;
  settled(conversationId: string): void;
}

interface Entry {
  connection: LiveConnection;
  timer: NodeJS.Timeout | null;
}

export function createLivePool(idleMs = liveIdleMs()): LivePool {
  const entries = new Map<string, Entry>();
  const listeners = new Set<(conversationId: string) => void>();

  const stopTimer = (entry: Entry) => {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
  };
  const drop = (conversationId: string, connection: LiveConnection) => {
    const entry = entries.get(conversationId);
    if (entry?.connection !== connection) return;
    stopTimer(entry);
    entries.delete(conversationId);
  };
  const close = async (conversationId: string) => {
    const entry = entries.get(conversationId);
    if (!entry) return;
    drop(conversationId, entry.connection);
    await entry.connection.close();
  };
  const quiet = (connection: LiveConnection) =>
    !connection.bound() && !connection.waiting() && connection.background?.busy() !== true;

  return {
    get(conversationId) {
      const entry = entries.get(conversationId);
      if (!entry || entry.connection.gone()) return null;
      stopTimer(entry);
      return entry.connection;
    },
    keep(conversationId, connection) {
      const existing = entries.get(conversationId);
      if (existing?.connection === connection) return;
      if (existing) void close(conversationId);
      entries.set(conversationId, { connection, timer: null });
      connection.onGone(() => drop(conversationId, connection));
      connection.onUnbound(() => {
        for (const listener of listeners) listener(conversationId);
      });
    },
    settled(conversationId) {
      const entry = entries.get(conversationId);
      if (!entry) return;
      stopTimer(entry);
      if (!quiet(entry.connection)) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (entries.get(conversationId) === entry && quiet(entry.connection)) {
          void close(conversationId);
        }
      }, idleMs);
      entry.timer.unref();
    },
    async closeSession(sessionId) {
      for (const [conversationId, entry] of entries) {
        if (entry.connection.opened()?.session.sessionId === sessionId) await close(conversationId);
      }
    },
    onCycle(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    waiting() {
      return [...entries]
        .filter(([, entry]) => !entry.connection.bound() && entry.connection.waiting())
        .map(([conversationId]) => conversationId);
    },
    conversations: () => [...entries.keys()],
    workdirs: () => [...entries.values()].map((entry) => entry.connection.home),
    close,
    async closeAll() {
      await Promise.all([...entries.keys()].map((conversationId) => close(conversationId)));
    },
  };
}
