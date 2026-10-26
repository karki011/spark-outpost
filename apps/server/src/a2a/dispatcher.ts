import type { AppEvent } from '@spark-outpost/contracts';
import type { OutboundRequest, PeerAgent } from '../outposts/ports.ts';
import type { ParentWorkReady } from '../outposts/stacked-parent-work.ts';
import { queueWrapUps } from '../outposts/story-wrap-ups.ts';
import type { Db } from '../persistence/db.ts';
import { unsentRequests } from '../persistence/outpost-posts.ts';
import { releaseAnswered } from './hold-release.ts';

export interface DispatchDeps {
  db: Db;
  peer: PeerAgent;
  parentWork?: ParentWorkReady;
}

export interface Dispatcher {
  changed(event: AppEvent): void;
  close(): Promise<void>;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

async function attempt(failure: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.error(`${failure} (${errorName(error)}).`);
  }
}

export async function dispatchUnsent(db: Db, peer: PeerAgent): Promise<number> {
  const destinations = new Map<string, OutboundRequest[]>();
  for (const post of await unsentRequests(db)) {
    if (post.toConversationId === null) continue;
    const requests = destinations.get(post.toConversationId) ?? [];
    requests.push({
      postId: post.id,
      outpostId: post.outpostId,
      toConversationId: post.toConversationId,
      body: post.body,
    });
    destinations.set(post.toConversationId, requests);
  }
  const counts = await Promise.all(
    [...destinations.values()].map(async (requests) => {
      let sent = 0;
      for (const request of requests) {
        try {
          await peer.send(request);
          sent += 1;
        } catch (error) {
          console.error(`Outpost request ${request.postId} was not sent (${errorName(error)}).`);
        }
      }
      return sent;
    }),
  );
  return counts.reduce((total, sent) => total + sent, 0);
}

export function startDispatcher(deps: DispatchDeps): Dispatcher {
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;

  async function passes(): Promise<void> {
    do {
      again = false;
      await attempt('Held outpost requests were not released', () =>
        releaseAnswered(deps.db, deps.parentWork),
      );
      await attempt('Story wrap-ups were not written', () => queueWrapUps(deps.db));
      await attempt('Outpost requests were not sent', () => dispatchUnsent(deps.db, deps.peer));
    } while (again && !closed);
    running = null;
  }

  function wake(): void {
    if (closed) return;
    if (running) {
      again = true;
      return;
    }
    running = passes();
  }

  wake();
  return {
    changed(event) {
      if (event.kind === 'outpost_changed' || event.kind === 'spark_pause') wake();
    },
    async close() {
      closed = true;
      await running;
    },
  };
}
