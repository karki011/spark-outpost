import type { AppEvent } from '@spark-outpost/contracts';
import type { PeerAgent, PostStore, StoredPost } from '../outposts/ports.ts';
import type { Db, Queryable } from '../persistence/db.ts';

export interface DispatchDeps {
  db: Db;
  peer: PeerAgent;
  unsentRequests: PostStore['unsentRequests'];
}

export interface Dispatcher {
  changed(event: AppEvent): void;
  close(): Promise<void>;
}

async function pausedOutposts(db: Queryable, posts: readonly StoredPost[]): Promise<Set<string>> {
  if (posts.length === 0) return new Set();
  const { rows } = await db.query<{ id: string }>(
    'SELECT id FROM outposts WHERE id = ANY($1::uuid[]) AND paused_at IS NOT NULL',
    [[...new Set(posts.map((post) => post.outpostId))]],
  );
  return new Set(rows.map((row) => row.id));
}

export function sendable(post: StoredPost, paused: ReadonlySet<string>): boolean {
  return (
    post.kind === 'request' &&
    post.taskId === null &&
    post.closedState === null &&
    post.toConversationId !== null &&
    !paused.has(post.outpostId)
  );
}

function byCreation(a: StoredPost, b: StoredPost): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

export async function dispatchUnsent({ db, peer, unsentRequests }: DispatchDeps): Promise<number> {
  const unsent = await unsentRequests(db);
  const paused = await pausedOutposts(db, unsent);
  let sent = 0;
  for (const post of unsent.filter((candidate) => sendable(candidate, paused)).sort(byCreation)) {
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
      try {
        await dispatchUnsent(deps);
      } catch (error) {
        console.error(`Outpost requests were not sent (${errorName(error)}).`);
      }
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
