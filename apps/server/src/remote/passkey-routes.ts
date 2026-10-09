import { Router, type Request, type Response } from 'express';
import {
  passkeyAssertionSchema,
  passkeyRegistrationSchema,
  type PasskeySignInResponse,
  type RemotePasskey,
  type RemotePasskeyList,
} from '@spark-outpost/contracts';
import { parseBody } from '../api/validation.ts';
import type { Db } from '../persistence/db.ts';
import { AttemptWindow, RateLimitError } from './attempt-window.ts';
import { deviceBinding, ticketBinding, type PasskeyChallenges } from './passkey-challenges.ts';
import { counterOutcome, signInRefusal } from './passkey-decision.ts';
import { passkeyLabel } from './passkey-labels.ts';
import {
  addPasskey,
  devicePasskeys,
  passkeyForSignIn,
  recordPasskeySignIn,
  type PasskeyRow,
} from './passkey-store.ts';
import {
  challengeOf,
  creationOptions,
  deviceIdOfUserHandle,
  requestOptions,
  verifyAssertion,
  verifyRegistration,
} from './passkey-webauthn.ts';
import { isRemote, remoteDeviceOf, type RemoteDevicePrincipal } from './principal.ts';
import {
  deviceCookie,
  newSecret,
  passkeyTicketCookie,
  passkeyTicketOf,
  secretHash,
} from './session.ts';
import { recordRemoteAudit, remoteAccess, type AuditInput } from './store.ts';

export interface PasskeyRouteDeps {
  db: Db;
  workspaceId: string;
  challenges: PasskeyChallenges;
}

const SIGN_IN_LIMIT = 5;
const NOT_FOUND = 'Not found.';
const SIGN_IN_REFUSED = 'That passkey did not work here. Pair with a code from your Mac.';
const SAVE_REFUSED = 'That passkey could not be saved. Try again.';
const ALREADY_SAVED = 'That passkey is already saved for a device.';
const TOO_MANY = 'Too many passkey attempts. Wait a minute and try again.';

export function toPasskey(row: PasskeyRow): RemotePasskey {
  return {
    id: row.id,
    label: row.label,
    synced: row.synced,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  };
}

export function passkeyRoutes(deps: PasskeyRouteDeps): Router {
  const { db, workspaceId, challenges } = deps;
  const refusal = () => new RateLimitError(TOO_MANY);
  const optionCalls = new AttemptWindow(SIGN_IN_LIMIT, Date.now, refusal);
  const attempts = new AttemptWindow(SIGN_IN_LIMIT, Date.now, refusal);
  const router = Router();
  const audit = (entry: AuditInput) => recordRemoteAudit(db, workspaceId, entry);

  const remoteOnly = (res: Response): boolean => {
    if (isRemote(res)) return true;
    res.status(404).json({ error: NOT_FOUND });
    return false;
  };

  const pairedDevice = (res: Response): RemoteDevicePrincipal | null => {
    const device = remoteDeviceOf(res);
    if (!device) res.status(404).json({ error: NOT_FOUND });
    return device;
  };

  const withinLimit = (res: Response, window: AttemptWindow): boolean => {
    try {
      window.take();
      return true;
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      res.status(429).json({ error: error.message });
      return false;
    }
  };

  const hostnameOrRefuse = async (res: Response): Promise<string | null> => {
    const access = await remoteAccess(db, workspaceId);
    if (access.hostname && access.switches.passkeys) return access.hostname;
    res.status(403).json({ error: SIGN_IN_REFUSED });
    return null;
  };

  const listFor = async (deviceId: string): Promise<RemotePasskeyList> => ({
    passkeys: (await devicePasskeys(db, workspaceId, deviceId)).map(toPasskey),
  });

  const refuseSignIn = async (
    res: Response,
    reason: string,
    device: RemoteDevicePrincipal | null = null,
  ) => {
    await audit({ action: 'passkey_sign_in_failed', device, status: 403, detail: { reason } });
    res
      .status(403)
      .set({ 'Cache-Control': 'no-store', 'Set-Cookie': passkeyTicketCookie(null) })
      .json({ error: SIGN_IN_REFUSED });
  };

  router.post('/remote/passkey/sign-in/options', async (_req, res) => {
    if (!remoteOnly(res) || !withinLimit(res, optionCalls)) return;
    const hostname = await hostnameOrRefuse(res);
    if (!hostname) return;
    const ticket = newSecret();
    const challenge = challenges.issue(ticketBinding(secretHash(ticket)));
    res
      .set({ 'Cache-Control': 'no-store', 'Set-Cookie': passkeyTicketCookie(ticket) })
      .json(await requestOptions(hostname, challenge));
  });

  router.post('/remote/passkey/sign-in', async (req: Request, res) => {
    if (!remoteOnly(res)) return;
    const assertion = parseBody(passkeyAssertionSchema, req);
    if (!withinLimit(res, attempts)) return;
    const access = await remoteAccess(db, workspaceId);
    const ticket = passkeyTicketOf(req.headers.cookie);
    const challenge = challengeOf(assertion.response.clientDataJSON);
    const challengeFresh =
      ticket !== null &&
      challenge !== null &&
      challenges.consume(challenge, ticketBinding(secretHash(ticket)));
    const passkey = await passkeyForSignIn(db, workspaceId, assertion.id);
    const device = passkey ? { id: passkey.device_id, name: passkey.device_name } : null;
    const refused = signInRefusal({
      allowed: access.hostname !== null && access.switches.passkeys,
      challengeFresh,
      credential: passkey
        ? { deviceId: passkey.device_id, revoked: passkey.revoked, expired: passkey.expired }
        : null,
      userHandleDeviceId: deviceIdOfUserHandle(assertion.response.userHandle),
    });
    if (refused || !passkey || !device || !access.hostname || !challenge) {
      await refuseSignIn(res, refused ?? 'challenge', device);
      return;
    }
    const verified = await verifyAssertion(
      access.hostname,
      challenge,
      assertion,
      passkey.public_key,
    );
    if (!verified) {
      await refuseSignIn(res, 'verification', device);
      return;
    }
    const counter = counterOutcome(Number(passkey.sign_count), verified.counter);
    const token = newSecret();
    const recorded = await recordPasskeySignIn(db, workspaceId, {
      passkeyId: passkey.id,
      deviceId: device.id,
      counter: counter.next,
      tokenHash: secretHash(token),
    });
    if (!recorded) {
      await refuseSignIn(res, 'device_revoked', device);
      return;
    }
    await audit({
      action: 'device_passkey_sign_in',
      device,
      detail: counter.regressed ? { counter: 'regressed' } : {},
    });
    res
      .set('Cache-Control', 'no-store')
      .append('Set-Cookie', deviceCookie(token))
      .append('Set-Cookie', passkeyTicketCookie(null))
      .json({ status: 'signed_in' } satisfies PasskeySignInResponse);
  });

  router.get('/remote/passkeys', async (_req, res) => {
    if (!remoteOnly(res)) return;
    const device = pairedDevice(res);
    if (device) res.json(await listFor(device.id));
  });

  router.post('/remote/passkeys/options', async (_req, res) => {
    if (!remoteOnly(res)) return;
    const device = pairedDevice(res);
    const access = await remoteAccess(db, workspaceId);
    if (!device || !access.hostname) return;
    const existing = await devicePasskeys(db, workspaceId, device.id);
    const options = await creationOptions({
      hostname: access.hostname,
      challenge: challenges.issue(deviceBinding(device.id)),
      device,
      existing: existing.map((row) => ({
        credentialId: row.credential_id,
        transports: row.transports,
      })),
    });
    res.set('Cache-Control', 'no-store').json(options);
  });

  router.post('/remote/passkeys', async (req: Request, res) => {
    if (!remoteOnly(res)) return;
    const device = pairedDevice(res);
    if (!device) return;
    const registration = parseBody(passkeyRegistrationSchema, req);
    const access = await remoteAccess(db, workspaceId);
    const challenge = challengeOf(registration.response.clientDataJSON);
    const fresh = challenge !== null && challenges.consume(challenge, deviceBinding(device.id));
    const verified =
      fresh && access.hostname
        ? await verifyRegistration(access.hostname, challenge, registration)
        : null;
    if (!verified) {
      res.status(400).json({ error: SAVE_REFUSED });
      return;
    }
    const label = passkeyLabel(verified.aaguid);
    const added = await addPasskey(db, workspaceId, {
      deviceId: device.id,
      credentialId: verified.credentialId,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: registration.response.transports ?? [],
      synced: verified.synced,
      label,
    });
    if (!added) {
      res.status(409).json({ error: ALREADY_SAVED });
      return;
    }
    await audit({
      action: 'device_passkey_added',
      device,
      detail: { label, synced: verified.synced },
    });
    res.status(201).json(await listFor(device.id));
  });

  return router;
}
