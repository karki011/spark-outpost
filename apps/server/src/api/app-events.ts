import type { Request, Response } from 'express';
import { parseAppEvent, type AppEvent } from '@spark-outpost/contracts';
import { listen, type NotificationListener } from '../persistence/notifications.ts';

const APP_EVENT_CLIENT_LIMIT = 32;
const HEARTBEAT_MS = 15_000;
const CLIENT_RETRY_MS = 2_000;
const RELISTEN_MS = 2_000;

export class AppEventFeed {
  private readonly clients = new Set<Response>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private available = true;

  constructor(
    private readonly clientLimit = APP_EVENT_CLIENT_LIMIT,
    private readonly observe?: (event: AppEvent) => void,
  ) {}

  get clientCount(): number {
    return this.clients.size;
  }

  publish(payload: string): void {
    const event = parseAppEvent(payload);
    if (!event) return;
    this.observe?.(event);
    this.broadcast(`data: ${JSON.stringify(event)}\n\n`);
  }

  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.disconnectAll();
  }

  disconnectAll(): void {
    for (const client of this.clients) client.end();
    this.clients.clear();
    this.stopHeartbeat();
  }

  subscribe(req: Request, res: Response): void {
    if (!this.available) {
      res.status(503).json({ error: 'Live updates are reconnecting.' });
      return;
    }
    if (this.clients.size >= this.clientLimit) {
      res.status(503).json({ error: 'Too many live update connections are open.' });
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(`retry: ${CLIENT_RETRY_MS}\n\n`);
    this.clients.add(res);
    this.startHeartbeat();
    req.on('close', () => {
      this.clients.delete(res);
      if (this.clients.size === 0) this.stopHeartbeat();
    });
  }

  private broadcast(frame: string): void {
    for (const client of this.clients) {
      if (!client.writableEnded) client.write(frame);
    }
  }

  private startHeartbeat(): void {
    this.heartbeat ??= setInterval(() => this.broadcast(': keep-alive\n\n'), HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

export async function listenForAppEvents(
  connectionString: string,
  feed: AppEventFeed,
  searchPath?: string,
): Promise<NotificationListener> {
  let current: NotificationListener | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () =>
    listen(connectionString, 'changes', (payload) => feed.publish(payload), {
      ...(searchPath ? { searchPath } : {}),
      onError: lost,
    });

  function lost() {
    if (closed || retry) return;
    feed.setAvailable(false);
    void current?.close();
    current = null;
    scheduleReconnect();
  }

  function scheduleReconnect() {
    retry = setTimeout(async () => {
      if (closed) return;
      try {
        const next = await connect();
        retry = null;
        if (closed) {
          await next.close();
          return;
        }
        current = next;
        feed.setAvailable(true);
      } catch {
        retry = null;
        scheduleReconnect();
      }
    }, RELISTEN_MS);
  }

  current = await connect();
  return {
    async close() {
      closed = true;
      if (retry) clearTimeout(retry);
      feed.disconnectAll();
      await current?.close();
    },
  };
}
