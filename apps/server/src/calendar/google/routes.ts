import { Router } from 'express';
import { startGoogleSignInSchema, type CalendarStatus } from '@spark-outpost/contracts';
import { BadRequestError, paramId, parseBody } from '../../api/validation.ts';
import { GoogleUnavailable, type GoogleSource } from './source.ts';

export interface GoogleRouteDeps {
  google: GoogleSource | null;
  status: () => Promise<CalendarStatus>;
  macUids: () => Promise<string[]>;
}

export const GOOGLE_NOT_REVOKED =
  'Spark deleted the sign-in, but Google didn’t confirm the revoke. Remove Spark Outpost at myaccount.google.com/permissions.';

export function googleCalendarRoutes(deps: GoogleRouteDeps): Router {
  const router = Router();
  const need = (): GoogleSource => {
    if (!deps.google?.status().available)
      throw new BadRequestError(new GoogleUnavailable().message);
    return deps.google;
  };

  router.get('/calendar/google/sign-in', (_req, res) => {
    res.json(need().signInFlow());
  });

  router.post('/calendar/google/sign-in', async (req, res) => {
    const request = parseBody(startGoogleSignInSchema, req);
    res.json(
      await need().signIn({
        accountId: request.accountId ?? null,
        editCalendar: request.editCalendar ?? null,
      }),
    );
  });

  router.delete('/calendar/google/sign-in', (_req, res) => {
    res.json(need().cancelSignIn());
  });

  router.delete('/calendar/google/accounts/:id', async (req, res) => {
    const result = await need().disconnect(paramId(req, 'id'), await deps.macUids());
    if (!result.found) throw new BadRequestError('That Google account is not connected.');
    res.json({
      status: await deps.status(),
      message: result.revoked ? null : GOOGLE_NOT_REVOKED,
    });
  });

  return router;
}
