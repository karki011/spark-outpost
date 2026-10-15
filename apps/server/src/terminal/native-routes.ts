import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  nativeTerminalLaunchRequestSchema,
  terminalApprovalDecisionSchema,
  terminalImageRequestSchema,
  terminalMessageRequestSchema,
} from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import { NativeTerminalConflictError } from '../persistence/native-terminal-turns.ts';
import { remoteDeviceOf } from '../remote/principal.ts';
import { NativeRuntimeError } from './native-control.ts';
import type { NativeRuntime } from './native-runtime.ts';

export function nativeTerminalRoutes(runtime?: NativeRuntime): Router {
  const router = Router();
  const available = (_req: Request, res: Response, next: NextFunction) => {
    if (!runtime)
      return res.status(503).json({ error: 'Terminal agents are unavailable on this host.' });
    return next();
  };
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
