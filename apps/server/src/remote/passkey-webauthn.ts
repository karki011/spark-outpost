import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { z } from 'zod';
import {
  PASSKEY_ALGORITHMS,
  PASSKEY_CHALLENGE_TTL_MS,
  type PasskeyAssertion,
  type PasskeyCreationOptions,
  type PasskeyRegistration,
  type PasskeyRequestOptions,
} from '@spark-outpost/contracts';

const RP_NAME = 'Spark Outpost';
const ALGORITHMS = [...PASSKEY_ALGORITHMS];
const USER_HANDLE_BYTES = 16;
const UNREADABLE_HANDLE = 'unreadable';

const clientDataSchema = z.object({ challenge: z.string().min(1).max(128) });

function bytesOf(base64Url: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(base64Url, 'base64url'));
}

export function challengeOf(clientDataJson: string): string | null {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(clientDataJson, 'base64url').toString('utf8'));
    const parsed = clientDataSchema.safeParse(decoded);
    return parsed.success ? parsed.data.challenge : null;
  } catch {
    return null;
  }
}

function userHandleOf(deviceId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(deviceId.replaceAll('-', ''), 'hex'));
}

export function deviceIdOfUserHandle(userHandle: string | undefined): string | null {
  if (!userHandle) return null;
  const hex = Buffer.from(userHandle, 'base64url').toString('hex');
  if (hex.length !== USER_HANDLE_BYTES * 2) return UNREADABLE_HANDLE;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export interface CreationInput {
  hostname: string;
  challenge: string;
  device: { id: string; name: string };
  existing: { credentialId: string; transports: string[] }[];
}

export async function creationOptions(input: CreationInput): Promise<PasskeyCreationOptions> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: input.hostname,
    userID: userHandleOf(input.device.id),
    userName: input.device.name,
    userDisplayName: input.device.name,
    challenge: bytesOf(input.challenge),
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    attestationType: 'none',
    supportedAlgorithmIDs: ALGORITHMS,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: input.existing.map((passkey) => ({
      id: passkey.credentialId,
      transports: passkey.transports,
    })),
  });
  return {
    rp: { id: input.hostname, name: RP_NAME },
    user: options.user,
    challenge: options.challenge,
    pubKeyCredParams: options.pubKeyCredParams.map(({ alg }) => ({ type: 'public-key', alg })),
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    attestation: 'none',
    excludeCredentials: input.existing.map((passkey) => ({
      id: passkey.credentialId,
      type: 'public-key',
      transports: passkey.transports,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
  };
}

export async function requestOptions(
  hostname: string,
  challenge: string,
): Promise<PasskeyRequestOptions> {
  const options = await generateAuthenticationOptions({
    rpID: hostname,
    challenge: bytesOf(challenge),
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: 'required',
  });
  return {
    rpId: hostname,
    challenge: options.challenge,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: 'required',
  };
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  aaguid: string;
  synced: boolean;
}

export async function verifyRegistration(
  hostname: string,
  challenge: string,
  response: PasskeyRegistration,
): Promise<VerifiedRegistration | null> {
  try {
    const result = await verifyRegistrationResponse({
      response: {
        id: response.id,
        rawId: response.rawId,
        type: response.type,
        clientExtensionResults: {},
        response: {
          clientDataJSON: response.response.clientDataJSON,
          attestationObject: response.response.attestationObject,
        },
      },
      expectedChallenge: challenge,
      expectedOrigin: `https://${hostname}`,
      expectedRPID: hostname,
      requireUserVerification: true,
      supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!result.verified) return null;
    const { credential, aaguid, credentialBackedUp } = result.registrationInfo;
    if (credential.id !== response.id) return null;
    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      aaguid,
      synced: credentialBackedUp,
    };
  } catch {
    return null;
  }
}

export async function verifyAssertion(
  hostname: string,
  challenge: string,
  response: PasskeyAssertion,
  publicKey: Uint8Array,
): Promise<{ counter: number } | null> {
  try {
    const result = await verifyAuthenticationResponse({
      response: {
        id: response.id,
        rawId: response.rawId,
        type: response.type,
        clientExtensionResults: {},
        response: {
          clientDataJSON: response.response.clientDataJSON,
          authenticatorData: response.response.authenticatorData,
          signature: response.response.signature,
        },
      },
      expectedChallenge: challenge,
      expectedOrigin: `https://${hostname}`,
      expectedRPID: hostname,
      requireUserVerification: true,
      credential: { id: response.id, publicKey: new Uint8Array(publicKey), counter: 0 },
    });
    return result.verified ? { counter: result.authenticationInfo.newCounter } : null;
  } catch {
    return null;
  }
}
