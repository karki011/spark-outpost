import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const XATTR = '/usr/bin/xattr';
const QUARANTINE = 'com.apple.quarantine';
const DOWNLOADED_FLAGS = '0081';
export const INTERNET_ZONE = '[ZoneTransfer]\r\nZoneId=3\r\n';

export function quarantineValue(now: Date, agent: string, eventId: string): string {
  const seconds = Math.floor(now.getTime() / 1000).toString(16);
  return `${DOWNLOADED_FLAGS};${seconds};${agent.replace(/;/g, ' ')};${eventId.toUpperCase()}`;
}

export function zoneIdentifierStream(filePath: string): string {
  return `${filePath}:Zone.Identifier`;
}

function markFromInternet(filePath: string): Promise<boolean> {
  return writeFile(zoneIdentifierStream(filePath), INTERNET_ZONE).then(
    () => true,
    () => false,
  );
}

export function markQuarantined(filePath: string, agent: string): Promise<boolean> {
  if (process.platform === 'win32') return markFromInternet(filePath);
  if (process.platform !== 'darwin') return Promise.resolve(true);
  const value = quarantineValue(new Date(), agent, randomUUID());
  return new Promise((resolve) => {
    execFile(XATTR, ['-w', QUARANTINE, value, filePath], (error) => resolve(error === null));
  });
}
