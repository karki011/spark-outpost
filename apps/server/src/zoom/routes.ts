import { Router } from 'express';
import { BadRequestError } from '../api/validation.ts';
import { ZOOM_UNAVAILABLE, type ZoomService } from './service.ts';

export interface ZoomRouteDeps {
  zoom?: ZoomService | null;
}

export const ZOOM_NOT_REVOKED =
  'Spark deleted the sign-in, but Zoom didn’t confirm the revoke. Remove Spark Outpost under Added Apps at marketplace.zoom.us.';

const UNAVAILABLE = { available: false, account: null };

export function zoomRoutes(deps: ZoomRouteDeps): Router {
  const router = Router();
  const need = (): ZoomService => {
    if (!deps.zoom) throw new BadRequestError(ZOOM_UNAVAILABLE);
    return deps.zoom;
  };

  router.get('/zoom/status', async (_req, res) => {
    if (!deps.zoom) {
      res.json({
        ...UNAVAILABLE,
        signIn: { status: 'idle', authorizeUrl: null, expiresAt: null, message: null },
      });
      return;
    }
    res.json(await deps.zoom.status());
  });

  router.post('/zoom/sign-in', async (_req, res) => {
    const zoom = need();
    if (!(await zoom.status()).available) throw new BadRequestError(ZOOM_UNAVAILABLE);
    res.json(await zoom.signIn());
  });

  router.delete('/zoom/sign-in', (_req, res) => {
    res.json(need().cancelSignIn());
  });

  router.delete('/zoom/account', async (_req, res) => {
    const zoom = need();
    const result = await zoom.disconnect();
    if (!result.found) throw new BadRequestError('Zoom is not connected.');
    res.json({ status: await zoom.status(), message: result.revoked ? null : ZOOM_NOT_REVOKED });
  });

  return router;
}
