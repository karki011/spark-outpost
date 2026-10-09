import type { AppEvent } from '@spark-outpost/contracts';
import type { Router } from 'express';
import { a2aBaseUrl } from '../a2a/agent-card.ts';
import { startDispatcher, type Dispatcher } from '../a2a/dispatcher.ts';
import { loopbackPeer } from '../a2a/peer-client.ts';
import { a2aRoutes } from '../a2a/router.ts';
import { TaskWakes } from '../a2a/task-wakes.ts';
import { outpostRoutes } from '../api/outpost-routes.ts';
import { resolveRunTarget } from '../api/run-target.ts';
import type { Db } from '../persistence/db.ts';
import { drainQueue } from '../workflow/queue-drain.ts';
import type { PeerAgent } from './ports.ts';

export interface OutpostDelivery {
  wakes: TaskWakes;
  peer: PeerAgent;
  changed(event: AppEvent): void;
  start(): void;
  close(): Promise<void>;
}

export interface OutpostDeliveryOptions {
  db: Db;
  port: number;
  apiToken: string;
}

export function outpostDelivery({ db, port, apiToken }: OutpostDeliveryOptions): OutpostDelivery {
  const wakes = new TaskWakes();
  const peer = loopbackPeer(a2aBaseUrl(port), apiToken);
  let dispatcher: Dispatcher | null = null;
  let closed = false;
  return {
    wakes,
    peer,
    changed(event) {
      wakes.changed(event);
      dispatcher?.changed(event);
    },
    start() {
      if (closed) return;
      dispatcher ??= startDispatcher({ db, peer });
    },
    async close() {
      closed = true;
      await dispatcher?.close();
    },
  };
}

export interface OutpostRouterOptions {
  db: Db;
  workspaceId: string;
  fixedRunProvider?: string;
  port: number;
  outposts: OutpostDelivery;
}

export function outpostRouters(options: OutpostRouterOptions): { api: Router; a2a: Router } {
  const { db, workspaceId, fixedRunProvider, outposts } = options;
  return {
    api: outpostRoutes({
      db,
      workspaceId,
      peer: outposts.peer,
      drain: (conversationId) =>
        drainQueue(db, conversationId, (id) =>
          resolveRunTarget({ db, workspaceId, fixedRunProvider }, id),
        ),
    }),
    a2a: a2aRoutes({ ...options, wakes: outposts.wakes }),
  };
}
