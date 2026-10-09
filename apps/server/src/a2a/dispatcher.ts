import type { AppEvent } from '@spark-outpost/contracts';
import type { PeerAgent } from '../outposts/ports.ts';
import type { Db } from '../persistence/db.ts';
import { unsentRequests } from '../persistence/outpost-posts.ts';
import { releaseAnswered } from './hold-release.ts';

export interface DispatchDeps {
  db: Db;
  peer: PeerAgent;
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
  let sent = 0;
  for (const post of await unsentRequests(db)) {
    if (post.toConversationId === null) continue;
    try {
      await peer.send({
        postId: post.id,
        outpostId: post.outpostId,
        toConversationId: post.toConversationId,
        body: post.body,
      });
      sent += 1;
    } catch (error) {
      console.error(`Outpost request ${post.id} was not sent (${errorName(error)}).`);
    }
  }
  return sent;
}

export function startDispatcher(deps: DispatchDeps): Dispatcher {
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;

  async function passes(): Promise<void> {
    do {
      again = false;
      await attempt('Held outpost requests were not released', () => releaseAnswered(deps.db));
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
      if (event.kind === 'outpost_changed') wake();
    },
    async close() {
      closed = true;
      await running;
    },
  };
}
