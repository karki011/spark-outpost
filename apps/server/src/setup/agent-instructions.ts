import { constants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { isCredentialPath } from '../projects/path-policy.ts';

const MAX_FILE_BYTES = 16_000;

export class AgentInstructionsError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

export interface LoadedInstructions {
  text: string;
  fileError: string | null;
}

const tooLarge = () =>
  new AgentInstructionsError('The instructions file exceeds 16 KB.', 'it is larger than 16 KB');

const notText = () =>
  new AgentInstructionsError('Choose a UTF-8 text instructions file.', 'it is not UTF-8 text');

function decode(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw notText();
  }
}

async function fileText(handle: FileHandle): Promise<string> {
  const stat = await handle.stat();
  if (!stat.isFile()) throw notText();
  if (stat.size > MAX_FILE_BYTES) throw tooLarge();
  const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  if (bytesRead > MAX_FILE_BYTES) throw tooLarge();
  const content = decode(buffer.subarray(0, bytesRead));
  if (content.includes('\0')) throw notText();
  return content;
}

function unreadable(error: unknown): AgentInstructionsError {
  if (error instanceof AgentInstructionsError) return error;
  const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
  return new AgentInstructionsError(
    'The instructions file could not be read. Check its path and access.',
    missing ? 'it was moved or deleted' : 'it could not be opened',
  );
}

export async function readAgentInstructions(text: string, file: string): Promise<string> {
  const requested = file.trim();
  if (!requested) return text.trim();
  const path = requested.startsWith('~/') ? join(homedir(), requested.slice(2)) : requested;
  if (!isAbsolute(path))
    throw new AgentInstructionsError(
      'Use an absolute instructions file path or ~/path.',
      'its path is not absolute',
    );
  try {
    const resolved = await realpath(path);
    if (isCredentialPath(path) || isCredentialPath(resolved))
      throw new AgentInstructionsError(
        'Choose an instructions file, not a secret file or a folder that holds sign-in details.',
        'it is a secret file',
      );
    const handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const content = await fileText(handle);
      return [text.trim(), content.trim()].filter(Boolean).join('\n\n');
    } finally {
      await handle.close();
    }
  } catch (error) {
    throw unreadable(error);
  }
}

export async function loadAgentInstructions(
  text: string,
  file: string,
): Promise<LoadedInstructions> {
  try {
    return { text: await readAgentInstructions(text, file), fileError: null };
  } catch (error) {
    if (!(error instanceof AgentInstructionsError)) throw error;
    return { text: text.trim(), fileError: error.reason };
  }
}

export function instructionsFileNote(reason: string): string {
  return `Instruction file could not be read: ${reason}. Went on without it.`;
}
