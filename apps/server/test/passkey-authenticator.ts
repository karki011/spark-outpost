import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type {
  PasskeyAssertion,
  PasskeyCreationOptions,
  PasskeyRegistration,
  PasskeyRequestOptions,
} from '@spark-outpost/contracts';

const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const BACKUP_ELIGIBLE = 0x08;
const BACKED_UP = 0x10;
const ATTESTED = 0x40;
const COSE_EC2 = 2;
const COSE_ES256 = -7;
const COSE_P256 = 1;
const NO_AAGUID = '00000000-0000-0000-0000-000000000000';

export interface SoftPasskey {
  credentialId: string;
  privateKey: KeyObject;
  rpId: string;
  userHandle: string;
  synced: boolean;
}

export interface Ceremony {
  origin: string;
  rpId?: string;
  counter?: number;
  userVerified?: boolean;
  synced?: boolean;
  aaguid?: string;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(data: Uint8Array | string): Buffer {
  return createHash('sha256').update(data).digest();
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function flagsOf(ceremony: Ceremony, synced: boolean, attested: boolean): number {
  return (
    USER_PRESENT |
    (ceremony.userVerified === false ? 0 : USER_VERIFIED) |
    (synced ? BACKUP_ELIGIBLE | BACKED_UP : 0) |
    (attested ? ATTESTED : 0)
  );
}

function authenticatorData(rpId: string, flags: number, counter: number, rest: Buffer): Buffer {
  const count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  return Buffer.concat([sha256(rpId), Buffer.from([flags]), count, rest]);
}

function cosePublicKey(key: KeyObject): Uint8Array {
  const jwk = key.export({ format: 'jwk' });
  return isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, COSE_EC2],
      [3, COSE_ES256],
      [-1, COSE_P256],
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]),
  );
}

export function createPasskey(
  options: PasskeyCreationOptions,
  ceremony: Ceremony,
): { passkey: SoftPasskey; registration: PasskeyRegistration } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const rawId = randomBytes(32);
  const rpId = ceremony.rpId ?? options.rp.id;
  const synced = ceremony.synced ?? false;
  const idLength = Buffer.alloc(2);
  idLength.writeUInt16BE(rawId.length);
  const attested = Buffer.concat([
    Buffer.from((ceremony.aaguid ?? NO_AAGUID).replaceAll('-', ''), 'hex'),
    idLength,
    rawId,
    cosePublicKey(publicKey),
  ]);
  const authData = authenticatorData(
    rpId,
    flagsOf(ceremony, synced, true),
    ceremony.counter ?? 0,
    attested,
  );
  const attestationObject = isoCBOR.encode(
    new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'],
      ['attStmt', new Map<string, string>()],
      ['authData', new Uint8Array(authData)],
    ]),
  );
  const credentialId = base64Url(rawId);
  return {
    passkey: { credentialId, privateKey, rpId, userHandle: options.user.id, synced },
    registration: {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: base64Url(
          clientData('webauthn.create', options.challenge, ceremony.origin),
        ),
        attestationObject: base64Url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    },
  };
}

export function assertPasskey(
  passkey: SoftPasskey,
  options: PasskeyRequestOptions,
  ceremony: Ceremony,
): PasskeyAssertion {
  const clientDataJson = clientData('webauthn.get', options.challenge, ceremony.origin);
  const authData = authenticatorData(
    ceremony.rpId ?? passkey.rpId,
    flagsOf(ceremony, passkey.synced, false),
    ceremony.counter ?? 0,
    Buffer.alloc(0),
  );
  const signature = sign(
    'sha256',
    Buffer.concat([authData, sha256(clientDataJson)]),
    passkey.privateKey,
  );
  return {
    id: passkey.credentialId,
    rawId: passkey.credentialId,
    type: 'public-key',
    response: {
      clientDataJSON: base64Url(clientDataJson),
      authenticatorData: base64Url(authData),
      signature: base64Url(signature),
      userHandle: passkey.userHandle,
    },
  };
}
