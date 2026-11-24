import { createHash } from 'node:crypto';
import path from 'node:path';

const SOCKET_PATH_MAX_BYTES = 103;

export interface SessionHostPaths {
  directory: string;
  socket: string;
  token: string;
}

export function isPipe(socket: string): boolean {
  return socket.startsWith('\\\\.\\pipe\\');
}

function pipeName(directory: string): string {
  const key = createHash('sha256').update(directory.toLowerCase()).digest('hex').slice(0, 24);
  return `\\\\.\\pipe\\spark-outpost-sessions-${key}`;
}

export function sessionHostPaths(
  directory: string,
  platform: NodeJS.Platform = process.platform,
): SessionHostPaths {
  const files = platform === 'win32' ? path.win32 : path.posix;
  const socket = platform === 'win32' ? pipeName(directory) : files.join(directory, 's');
  if (!isPipe(socket) && Buffer.byteLength(socket) > SOCKET_PATH_MAX_BYTES)
    throw new Error('the data folder path is too long for its socket');
  return { directory, socket, token: files.join(directory, 'token') };
}
