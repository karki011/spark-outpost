import { Router } from 'express';
import type { ChatPortsResponse } from '@spark-outpost/contracts';
import type { ChatPortMap } from './chat-ports.ts';

export interface ChatPortRouteDeps {
  chatPorts?: { ports(): ChatPortMap } | undefined;
}

export function chatPortRoutes({ chatPorts }: ChatPortRouteDeps): Router {
  const router = Router();
  router.get('/chat-ports', (_req, res) => {
    const response: ChatPortsResponse = { ports: chatPorts?.ports() ?? {} };
    res.json(response);
  });
  return router;
}
