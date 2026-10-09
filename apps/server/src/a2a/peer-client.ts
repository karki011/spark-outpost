import type { Message, Task } from '@a2a-js/sdk';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  JsonRpcTransportFactory,
  type Client,
} from '@a2a-js/sdk/client';
import { TaskNotCancelableError } from '@a2a-js/sdk/errors';
import { API_TOKEN_HEADER } from '@spark-outpost/contracts';
import type { OutboundRequest, PeerAgent, TaskRef } from '../outposts/ports.ts';
import { chatEndpoint, TEXT_MODE } from './agent-card.ts';
import { wasDelivered } from './task-states.ts';
import { requestMessage, toTaskView } from './task-view.ts';

function withLaunchToken(token: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set(API_TOKEN_HEADER, token);
    return fetch(input, { ...init, headers });
  };
}

function isTask(result: Message | Task): result is Task {
  return 'status' in result;
}

export function loopbackPeer(baseUrl: string, token: string): PeerAgent {
  const fetchImpl = withLaunchToken(token);
  const factory = new ClientFactory(
    ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
      transports: [new JsonRpcTransportFactory({ fetchImpl })],
      cardResolver: new DefaultAgentCardResolver({ fetchImpl }),
    }),
  );
  const clients = new Map<string, Promise<Client>>();

  function clientFor(conversationId: string): Promise<Client> {
    const known = clients.get(conversationId);
    if (known) return known;
    const created = factory.createFromUrl(`${chatEndpoint(baseUrl, conversationId)}/`);
    clients.set(conversationId, created);
    created.catch(() => clients.delete(conversationId));
    return created;
  }

  async function get(task: TaskRef) {
    const client = await clientFor(task.conversationId);
    return toTaskView(await client.getTask({ tenant: '', id: task.taskId }));
  }

  return {
    async send(request: OutboundRequest) {
      const client = await clientFor(request.toConversationId);
      const result = await client.sendMessage({
        tenant: '',
        message: requestMessage(request),
        configuration: {
          acceptedOutputModes: [TEXT_MODE],
          taskPushNotificationConfig: undefined,
          returnImmediately: true,
        },
        metadata: undefined,
      });
      if (!isTask(result) || result.status === undefined) {
        throw new Error('The chat answered a request without a task.');
      }
      return { accepted: wasDelivered(result.status.state), task: toTaskView(result) };
    },

    get,

    async cancel(task: TaskRef) {
      const client = await clientFor(task.conversationId);
      try {
        return toTaskView(
          await client.cancelTask({ tenant: '', id: task.taskId, metadata: undefined }),
        );
      } catch (error) {
        if (!(error instanceof TaskNotCancelableError)) throw error;
        return get(task);
      }
    },
  };
}
