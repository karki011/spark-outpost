import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';

export function webApp(root: string) {
  const router = express.Router();
  const index = path.join(root, 'index.html');
  router.use(express.static(root, { index: false }));
  router.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(index);
  });
  return router;
}
