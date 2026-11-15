import { Router, type Request, type Response } from 'express';
import { passkeyAssertionSchema } from '@spark-outpost/contracts';
import { paramId, parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { AttemptWindow, RateLimitError } from './attempt-window.ts';
import { devicePlaceOf } from './card-place.ts';
import type { PasskeyChallenges } from './passkey-challenges.ts';
import { devicePasskeys, passkeyForSignIn, recordPasskeyUse } from './passkey-store.ts';
import { challengeOf, requestOptions, verifyAssertion } from './passkey-webauthn.ts';
import { remoteDeviceOf, type RemoteDevicePrincipal } from './principal.ts';
import { stepUpBinding, type StepUpGrants } from './step-up-grants.ts';
import { approvalPayload, recordRemoteAudit, remoteAccess } from './store.ts';

export interface StepUpRouteDeps {
  db: Db;
  workspaceId: string;
  challenges: PasskeyChallenges;
  grants: StepUpGrants;
  attemptsPerMinute?: number | undefined;
}

const STEP_UP_LIMIT = 5;
const NOT_FOUND = 'Not found.';
const NOT_NEEDED = 'This card does not need a passkey here.';
const REFUSED = 'That passkey did not confirm this card. Try again or answer on your Mac.';
const TOO_MANY = 'Too many passkey attempts. Wait a minute and try again.';

export function stepUpRoutes(deps: StepUpRouteDeps): Router {
  const { db, workspaceId, challenges, grants } = deps;
  const limit = deps.attemptsPerMinute ?? STEP_UP_LIMIT;
  const tooMany = () => new RateLimitError(TOO_MANY);
  const attempts = new AttemptWindow(limit, Date.now, tooMany);
  const router = Router();

  const withinLimit = (res: Response): boolean => {
    try {
      attempts.take();
      return true;
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      res.status(429).json({ error: error.message });
      return false;
    }
  };

  const stepUpCard = async (
    req: Request,
    res: Response,
  ): Promise<{ device: RemoteDevicePrincipal; approvalId: string; hostname: string } | null> => {
    const device = remoteDeviceOf(res);
    if (!device) {
      res.status(404).json({ error: NOT_FOUND });
      return null;
    }
    const approvalId = paramId(req);
    const payload = await approvalPayload(db, workspaceId, approvalId);
    const access = await remoteAccess(db, workspaceId);
    if (payload === null || !access.hostname) {
      res.status(404).json({ error: NOT_FOUND });
      return null;
    }
    const place = await devicePlaceOf(db, workspaceId, device.id, payload, access);
    if (place.place !== 'step_up') {
      res.status(409).json({ error: place.place === 'mac' ? place.reason : NOT_NEEDED });
      return null;
    }
    return { device, approvalId, hostname: access.hostname };
  };

  const refuse = async (res: Response, device: RemoteDevicePrincipal, reason: string) => {
    await recordRemoteAudit(db, workspaceId, {
      action: 'card_step_up_failed',
      device,
      status: 403,
      detail: { reason },
    });
    res.status(403).set('Cache-Control', 'no-store').json({ error: REFUSED });
  };

  router.post('/approvals/:id/step-up/options', async (req, res) => {
    if (!withinLimit(res)) return;
    const card = await stepUpCard(req, res);
    if (!card) return;
    const passkeys = await devicePasskeys(db, workspaceId, card.device.id);
    const challenge = challenges.issue(stepUpBinding(card.device.id, card.approvalId));
    const allowed = passkeys.map((row) => ({
      credentialId: row.credential_id,
      transports: row.transports,
    }));
    res
      .set('Cache-Control', 'no-store')
      .json(await requestOptions(card.hostname, challenge, allowed));
  });

  router.post('/approvals/:id/step-up', async (req, res) => {
    const assertion = parseBody(passkeyAssertionSchema, req);
    if (!withinLimit(res)) return;
    const card = await stepUpCard(req, res);
    if (!card) return;
    const challenge = challengeOf(assertion.response.clientDataJSON);
    const binding = stepUpBinding(card.device.id, card.approvalId);
    if (!challenge || !challenges.consume(challenge, binding)) {
      await refuse(res, card.device, 'challenge');
      return;
    }
    const passkey = await passkeyForSignIn(db, workspaceId, assertion.id);
    if (!passkey || passkey.device_id !== card.device.id || passkey.revoked) {
      await refuse(res, card.device, 'wrong_device');
      return;
    }
    const verified = await verifyAssertion(card.hostname, challenge, assertion, passkey.public_key);
    if (!verified) {
      await refuse(res, card.device, 'verification');
      return;
    }
    await recordPasskeyUse(db, passkey.id, Math.max(Number(passkey.sign_count), verified.counter));
    grants.grant(card.device.id, card.approvalId);
    await recordRemoteAudit(db, workspaceId, {
      action: 'card_step_up',
      device: card.device,
      detail: { approvalId: card.approvalId },
    });
    res.status(204).end();
  });

  return router;
}
