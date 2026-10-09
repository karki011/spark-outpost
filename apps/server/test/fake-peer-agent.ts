import { randomUUID } from 'node:crypto';
import type {
  OutboundRequest,
  PeerAgent,
  SendOutcome,
  TaskRef,
  TaskView,
} from '../src/outposts/ports.ts';

export interface FakePeerHandlers {
  send?: (request: OutboundRequest) => Promise<SendOutcome> | SendOutcome;
  get?: (task: TaskRef) => Promise<TaskView> | TaskView;
  cancel?: (task: TaskRef) => Promise<TaskView> | TaskView;
}

export interface FakePeerAgent extends PeerAgent {
  sent: OutboundRequest[];
  fetched: TaskRef[];
  cancelled: TaskRef[];
}

export function fakePeerAgent(handlers: FakePeerHandlers = {}): FakePeerAgent {
  const sent: OutboundRequest[] = [];
  const fetched: TaskRef[] = [];
  const cancelled: TaskRef[] = [];
  return {
    sent,
    fetched,
    cancelled,
    async send(request) {
      sent.push(request);
      if (handlers.send) return handlers.send(request);
      return { accepted: true, task: { taskId: randomUUID(), state: 'sent', reason: null } };
    },
    async get(task) {
      fetched.push(task);
      if (handlers.get) return handlers.get(task);
      return { taskId: task.taskId, state: 'sent', reason: null };
    },
    async cancel(task) {
      cancelled.push(task);
      if (handlers.cancel) return handlers.cancel(task);
      return { taskId: task.taskId, state: 'cancelled', reason: null };
    },
  };
}
