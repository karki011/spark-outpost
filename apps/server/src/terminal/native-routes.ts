import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  TERMINAL_LIVE_MAX_CHATS,
  nativeTerminalLaunchRequestSchema,
  parseTerminalLiveChats,
  terminalApprovalDecisionSchema,
  terminalImageRequestSchema,
  terminalMessageRequestSchema,
  type TerminalLive,
} from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import { NativeTerminalConflictError } from '../persistence/native-terminal-turns.ts';
import { remoteDeviceOf } from '../remote/principal.ts';
import { NativeRuntimeError } from './native-control.ts';
import type { NativeRuntime } from './native-runtime.ts';

function logUnexpected(chat: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === 'fulfilled') return;
  const { reason } = result;
  if (reason instanceof NativeRuntimeError && reason.status === 404) return;
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(`Could not read Terminal state for chat ${chat}: ${message}`);
}

async function terminalLive(
  runtime: NativeRuntime,
  chats: readonly string[],
): Promise<TerminalLive> {
  const entries = await Promise.all(
    chats.map(async (chat) => {
      const [session, usage] = await Promise.allSettled([runtime.get(chat), runtime.usage(chat)]);
      logUnexpected(chat, session);
      logUnexpected(chat, usage);
      return [
        chat,
        {
          ...(session.status === 'fulfilled' ? { session: session.value } : {}),
          ...(usage.status === 'fulfilled' ? { usage: usage.value } : {}),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export function nativeTerminalRoutes(runtime?: NativeRuntime): Router {
  const router = Router();
  const available = (_req: Request, res: Response, next: NextFunction) => {
    if (!runtime)
      return res.status(503).json({ error: 'Terminal agents are unavailable on this host.' });
    return next();
  };
  router.get('/terminal-agents', available, async (_req, res) => {
    res.json(await runtime!.agents());
  });
  router.get('/terminal-live', available, async (req, res) => {
    const chats = parseTerminalLiveChats(req.query.chats);
    if (!chats) {
      res.status(400).json({ error: `Name up to ${TERMINAL_LIVE_MAX_CHATS} chats.` });
      return;
    }
    res.json(await terminalLive(runtime!, chats));
  });
  router.get('/conversations/:id/terminal', available, async (req, res) => {
    res.json(await runtime!.get(paramId(req)));
  });
  router.get('/conversations/:id/terminal/usage', available, async (req, res) => {
    res.json(await runtime!.usage(paramId(req)));
  });
  router.get('/conversations/:id/terminal/start', available, async (req, res) => {
    res.json({ phase: await runtime!.startPhase(paramId(req)) });
  });
  router.post('/conversations/:id/terminal', available, async (req, res) => {
    res
      .status(201)
      .json(await runtime!.launch(paramId(req), parseBody(nativeTerminalLaunchRequestSchema, req)));
  });
  router.delete('/conversations/:id/terminal', available, async (req, res) => {
    await runtime!.stop(paramId(req));
    res.status(204).end();
  });
  router.post('/conversations/:id/terminal/images', available, async (req, res) => {
    const { attachmentId } = parseBody(terminalImageRequestSchema, req);
    res.status(201).json({ path: await runtime!.saveImage(paramId(req), attachmentId) });
  });
  router.get('/conversations/:id/terminal/transcript', available, async (req, res) => {
    res.json(await runtime!.remote.view(paramId(req), remoteDeviceOf(res) !== null));
  });
  router.post('/conversations/:id/terminal/message', available, async (req, res) => {
    const { text, now } = parseBody(terminalMessageRequestSchema, req);
    await runtime!.remote.message(paramId(req), text, now);
    res.status(204).end();
  });
  router.post('/conversations/:id/terminal/interrupt', available, async (req, res) => {
    await runtime!.remote.interrupt(paramId(req));
    res.status(204).end();
  });
  router.post('/conversations/:id/terminal/approval', available, async (req, res) => {
    const decision = parseBody(terminalApprovalDecisionSchema, req);
    await runtime!.remote.decide(paramId(req), decision);
    res.status(204).end();
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof NativeRuntimeError)
      return res.status(error.status).json({ error: error.message });
    if (error instanceof NativeTerminalConflictError)
      return res.status(409).json({ error: error.message });
    return next(error);
  });
  return router;
}
