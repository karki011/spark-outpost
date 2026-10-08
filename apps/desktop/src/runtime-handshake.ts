import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

const SOCKET_PATH_LIMIT = 103;

export interface RuntimePaths {
  socket: string;
  token: string;
  endpoint: string;
}

export function runtimePaths(directory: string): RuntimePaths {
  const socket = path.join(directory, 'control.sock');
  if (Buffer.byteLength(socket) > SOCKET_PATH_LIMIT)
    throw new Error(`The data folder path is too long for the local runtime socket: ${socket}`);
  return {
    socket,
    token: path.join(directory, 'token'),
    endpoint: path.join(directory, 'endpoint.json'),
  };
}

export function createSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function runtimeProof(
  token: string,
  role: 'host' | 'client',
  clientNonce: string,
  hostNonce: string,
): string {
  return createHmac('sha256', token)
    .update(JSON.stringify([role, clientNonce, hostNonce]))
    .digest('base64url');
}

export function sameProof(offered: string, expected: string): boolean {
  const left = Buffer.from(offered);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
