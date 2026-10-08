import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { isCredentialPath } from '../projects/path-policy.ts';

const MAX_FILE_BYTES = 16_000;

export class AgentInstructionsError extends Error {}

export async function readAgentInstructions(text: string, file: string): Promise<string> {
  const requested = file.trim();
  if (!requested) return text.trim();
  const path = requested.startsWith('~/') ? join(homedir(), requested.slice(2)) : requested;
  if (!isAbsolute(path))
    throw new AgentInstructionsError('Use an absolute instructions file path or ~/path.');
  try {
    const resolved = await realpath(path);
    if (isCredentialPath(path) || isCredentialPath(resolved))
      throw new AgentInstructionsError(
        'Choose an instructions file, not a secret file or a folder that holds sign-in details.',
      );
    const handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES)
        throw new AgentInstructionsError('Choose a UTF-8 text file up to 16 KB.');
      const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_FILE_BYTES)
        throw new AgentInstructionsError('The instructions file exceeds 16 KB.');
      const content = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(0, bytesRead),
      );
      if (content.includes('\0'))
        throw new AgentInstructionsError('Choose a UTF-8 text instructions file.');
      return [text.trim(), content.trim()].filter(Boolean).join('\n\n');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof AgentInstructionsError) throw error;
    throw new AgentInstructionsError(
      'The instructions file could not be read. Check its path and access.',
    );
  }
}
