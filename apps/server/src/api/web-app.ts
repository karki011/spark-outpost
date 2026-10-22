import express, { type NextFunction, type Request, type Response } from 'express';
import { CONTENT_SECURITY_POLICY_HEADER } from '@spark-outpost/contracts';

function isApiPath(req: Request): boolean {
  return req.path.startsWith('/api/');
}

export function webApp(root: string, policy: string) {
  const router = express.Router();
  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!isApiPath(req)) res.setHeader(CONTENT_SECURITY_POLICY_HEADER, policy);
    next();
  });
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
