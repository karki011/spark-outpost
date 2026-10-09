import type { PasskeyCreationOptions, PasskeyRegistration } from '@spark-outpost/contracts';

export type PasskeySaveProblem = 'exists' | 'not_saved';

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

export function bytesOf(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function base64UrlOf(buffer: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(buffer), (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function saveProblemOf(error: unknown): PasskeySaveProblem {
  const name = error instanceof Error ? error.name : '';
  return name === 'InvalidStateError' ? 'exists' : 'not_saved';
}

function transportsOf(response: AuthenticatorAttestationResponse): string[] | undefined {
  return typeof response.getTransports === 'function' ? response.getTransports() : undefined;
}

export async function createPasskey(
  options: PasskeyCreationOptions,
): Promise<PasskeyRegistration | null> {
  const credential = await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: bytesOf(options.challenge),
      user: { ...options.user, id: bytesOf(options.user.id) },
      excludeCredentials: options.excludeCredentials.map((excluded) => ({
        id: bytesOf(excluded.id),
        type: excluded.type,
        ...(excluded.transports
          ? { transports: excluded.transports as AuthenticatorTransport[] }
          : {}),
      })),
    },
  });
  if (!(credential instanceof PublicKeyCredential)) return null;
  const response = credential.response as AuthenticatorAttestationResponse;
  const transports = transportsOf(response);
  return {
    id: credential.id,
    rawId: base64UrlOf(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: base64UrlOf(response.clientDataJSON),
      attestationObject: base64UrlOf(response.attestationObject),
      ...(transports ? { transports } : {}),
    },
  };
}
