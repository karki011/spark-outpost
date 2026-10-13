import { Router, type Request, type Response, type NextFunction } from 'express';
import { nativeTerminalLaunchRequestSchema } from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import { NativeTerminalConflictError } from '../persistence/native-terminal-turns.ts';
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
  router.post('/conversations/:id/terminal', available, async (req, res) => {
    res
      .status(201)
      .json(await runtime!.launch(paramId(req), parseBody(nativeTerminalLaunchRequestSchema, req)));
  });
  router.delete('/conversations/:id/terminal', available, async (req, res) => {
    await runtime!.stop(paramId(req));
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
