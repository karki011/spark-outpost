import { createHash, randomBytes } from 'node:crypto';
import {
  ARTIFACT_SHARE_DELETE_TOKEN_BYTES,
  ARTIFACT_SHARE_ID_BYTES,
  ARTIFACT_SHARE_ID_DOMAIN,
} from '@spark-outpost/contracts';

export function shareIdForToken(deleteToken: string): string {
  return createHash('sha256')
    .update(`${ARTIFACT_SHARE_ID_DOMAIN}${deleteToken}`)
    .digest()
    .subarray(0, ARTIFACT_SHARE_ID_BYTES)
    .toString('base64url');
}

export function newShareKey(): { id: string; deleteToken: string } {
  const deleteToken = randomBytes(ARTIFACT_SHARE_DELETE_TOKEN_BYTES).toString('base64url');
  return { id: shareIdForToken(deleteToken), deleteToken };
}
