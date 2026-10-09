import {
  PASSKEY_TICKET_COOKIE,
  type PasskeyAssertion,
  type PasskeyCreationOptions,
  type PasskeyRequestOptions,
} from '@spark-outpost/contracts';
import type { createTestApp } from './app-support.ts';
import {
  assertPasskey,
  createPasskey,
  type Ceremony,
  type SoftPasskey,
} from './passkey-authenticator.ts';
import {
  REMOTE_ORIGIN,
  remoteClient,
  sessionCookieOf,
  type PairedDevice,
} from './remote-support.ts';
import type { TestDb } from './support.ts';

type TestApp = ReturnType<typeof createTestApp>;

export const SIGN_IN_REFUSED = 'That passkey did not work here. Pair with a code from your Mac.';

function setCookies(headers: Record<string, unknown>): string[] {
  return (headers['set-cookie'] as string[] | undefined) ?? [];
}

export async function savePasskey(
  app: TestApp,
  device: PairedDevice,
  ceremony: Partial<Ceremony> = {},
): Promise<SoftPasskey> {
  const phone = remoteClient(app, device.cookie);
  const options = await phone.send('post', '/api/remote/passkeys/options').expect(200);
  const { passkey, registration } = createPasskey(options.body as PasskeyCreationOptions, {
    origin: REMOTE_ORIGIN,
    ...ceremony,
  });
  await phone.send('post', '/api/remote/passkeys', registration).expect(201);
  return passkey;
}

export interface SignInStart {
  options: PasskeyRequestOptions;
  ticket: string;
  setCookie: string;
}

export async function startSignIn(app: TestApp): Promise<SignInStart> {
  const asked = await remoteClient(app)
    .send('post', '/api/remote/passkey/sign-in/options')
    .expect(200);
  const setCookie = setCookies(asked.headers).find((cookie) =>
    cookie.startsWith(PASSKEY_TICKET_COOKIE),
  )!;
  return {
    options: asked.body as PasskeyRequestOptions,
    ticket: sessionCookieOf(setCookie),
    setCookie,
  };
}

export function finishSignIn(app: TestApp, ticket: string | null, assertion: PasskeyAssertion) {
  return remoteClient(app, ticket).send('post', '/api/remote/passkey/sign-in', assertion);
}

export async function signIn(app: TestApp, passkey: SoftPasskey, ceremony: Partial<Ceremony> = {}) {
  const started = await startSignIn(app);
  const assertion = assertPasskey(passkey, started.options, { origin: REMOTE_ORIGIN, ...ceremony });
  return finishSignIn(app, started.ticket, assertion);
}

export async function signedIn(
  app: TestApp,
  passkey: SoftPasskey,
  ceremony: Partial<Ceremony> = {},
) {
  const response = await signIn(app, passkey, ceremony);
  if (response.status !== 200) throw new Error(`Passkey sign-in answered ${response.status}`);
  return response;
}

export function deviceCookieIn(headers: Record<string, unknown>): string | null {
  const found = setCookies(headers).find((cookie) => cookie.startsWith('__Host-spark_device='));
  return found ? sessionCookieOf(found) : null;
}

export async function passkeyAudit(t: TestDb, action: string) {
  const { rows } = await t.db.query<{ device_id: string | null; detail: Record<string, unknown> }>(
    'SELECT device_id, detail FROM remote_audit WHERE action = $1 ORDER BY created_at, id',
    [action],
  );
  return rows;
}
