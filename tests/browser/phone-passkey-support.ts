import type { BrowserContext, CDPSession, Page } from '@playwright/test';

export interface PhoneAuthenticator {
  session: CDPSession;
  id: string;
}

export interface ExportedPasskey {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

export async function addAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<PhoneAuthenticator> {
  const session = await context.newCDPSession(page);
  await session.send('WebAuthn.enable');
  const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { session, id: authenticatorId };
}

export async function passkeysIn(authenticator: PhoneAuthenticator): Promise<ExportedPasskey[]> {
  const { credentials } = await authenticator.session.send('WebAuthn.getCredentials', {
    authenticatorId: authenticator.id,
  });
  return credentials;
}

export async function copyPasskey(
  authenticator: PhoneAuthenticator,
  credential: ExportedPasskey,
): Promise<void> {
  await authenticator.session.send('WebAuthn.addCredential', {
    authenticatorId: authenticator.id,
    credential,
  });
}

export function savePasskeyByScript(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const bytes = (text: string) =>
      Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
        char.charCodeAt(0),
      );
    const encoded = (buffer: ArrayBuffer) =>
      btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
    const post = (path: string, body: object) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const options = await (await post('/api/remote/passkeys/options', {})).json();
    const credential = (await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: bytes(options.challenge),
        user: { ...options.user, id: bytes(options.user.id) },
        excludeCredentials: [],
      },
    })) as PublicKeyCredential;
    const response = credential.response as AuthenticatorAttestationResponse;
    const saved = await post('/api/remote/passkeys', {
      id: credential.id,
      rawId: encoded(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: encoded(response.clientDataJSON),
        attestationObject: encoded(response.attestationObject),
        transports: response.getTransports(),
      },
    });
    return saved.status;
  });
}

export function signInOptionsStatus(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const response = await fetch('/api/remote/passkey/sign-in/options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return response.status;
  });
}
