import { Router } from 'express';
import { startMicrosoftSignInSchema, type CalendarStatus } from '@spark-outpost/contracts';
import { BadRequestError, paramId, parseBody } from '../../api/validation.ts';
import { MicrosoftUnavailable, type MicrosoftSource } from './source.ts';

export interface MicrosoftRouteDeps {
  microsoft: MicrosoftSource | null;
  status: () => Promise<CalendarStatus>;
  otherUids: () => Promise<string[]>;
}

export const MICROSOFT_DISCONNECTED =
  'Spark deleted the sign-in. To remove Spark Outpost from your Microsoft account too, go to myapps.microsoft.com (work or school) or account.live.com/consent/Manage (personal).';

export function microsoftCalendarRoutes(deps: MicrosoftRouteDeps): Router {
  const router = Router();
  const need = (): MicrosoftSource => {
    if (!deps.microsoft?.status().available) {
      throw new BadRequestError(new MicrosoftUnavailable().message);
    }
    return deps.microsoft;
  };

  router.get('/calendar/microsoft/sign-in', (_req, res) => {
    res.json(need().signInFlow());
  });

  router.post('/calendar/microsoft/sign-in', async (req, res) => {
    const request = parseBody(startMicrosoftSignInSchema, req);
    res.json(
      await need().signIn({
        accountId: request.accountId ?? null,
        editCalendar: request.editCalendar ?? null,
      }),
    );
  });

  router.delete('/calendar/microsoft/sign-in', (_req, res) => {
    res.json(need().cancelSignIn());
  });

  router.delete('/calendar/microsoft/accounts/:id', async (req, res) => {
    const result = await need().disconnect(paramId(req, 'id'), await deps.otherUids());
    if (!result.found) throw new BadRequestError('That Microsoft account is not connected.');
    res.json({ status: await deps.status(), message: MICROSOFT_DISCONNECTED });
  });

  return router;
}
