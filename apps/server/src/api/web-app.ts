import express, { type NextFunction, type Request, type Response } from 'express';
import {
  APP_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_HEADER,
} from '@spark-outpost/contracts';

function isApiPath(req: Request): boolean {
  return req.path.startsWith('/api/');
}

function setContentSecurityPolicy(req: Request, res: Response, next: NextFunction) {
  if (!isApiPath(req)) res.setHeader(CONTENT_SECURITY_POLICY_HEADER, APP_CONTENT_SECURITY_POLICY);
  next();
}

export function webApp(root: string) {
  const router = express.Router();
  router.use(setContentSecurityPolicy);
  router.use(express.static(root, { index: false }));
  router.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req)) {
      next();
      return;
    }
    res.sendFile('index.html', { root });
  });
  return router;
}
