import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isRecord } from '../agent-config/records.ts';

export const ACCEPTED_RECORD = '.settings-accepted.json';
export const MISSING_HASH = 'missing';
export const UNREADABLE_HASH = 'unreadable';

export interface AcceptedRules {
  hash: string;
  text: string | null;
}

export type FileText =
  { kind: 'missing' } | { kind: 'text'; text: string } | { kind: 'unreadable' };

export function rulesTextHash(read: FileText): string {
  if (read.kind !== 'text') return read.kind === 'missing' ? MISSING_HASH : UNREADABLE_HASH;
  return createHash('sha256').update(read.text).digest('hex');
}

export function acceptedRecordPath(userFile: string): string {
  return join(dirname(userFile), ACCEPTED_RECORD);
}

export function acceptedOf(read: FileText): AcceptedRules {
  return { hash: rulesTextHash(read), text: read.kind === 'text' ? read.text : null };
}

export function acceptedRecordText(accepted: AcceptedRules): string {
  return `${JSON.stringify(accepted)}\n`;
}

function parsedRecord(text: string): AcceptedRules | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || typeof value.hash !== 'string') return null;
    if (value.text !== null && typeof value.text !== 'string') return null;
    return { hash: value.hash, text: value.text };
  } catch {
    return null;
  }
}

export async function readAccepted(userFile: string): Promise<AcceptedRules | null> {
  const text = await readFile(acceptedRecordPath(userFile), 'utf8').catch(() => null);
  return text === null ? null : parsedRecord(text);
}

export function acceptedRead(accepted: AcceptedRules): FileText {
  return accepted.text === null ? { kind: 'missing' } : { kind: 'text', text: accepted.text };
}
