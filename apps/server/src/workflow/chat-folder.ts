import { ensureChatWorkFolder } from '../chat-files/folders.ts';
import { recordChatFiles } from '../chat-files/record.ts';
import type { Db } from '../persistence/db.ts';
import type { Lease } from '../persistence/jobs.ts';
import { LeaseLostError } from '../persistence/run-events.ts';
import type { RunInput } from './run-input.ts';

export function wantsChatFolder(input: RunInput): boolean {
  if (input.projectRoots.length > 0 || input.assistant) return false;
  return input.mode === 'do' || input.mode === 'ask';
}

export async function withChatFolder(base: string | undefined, input: RunInput): Promise<RunInput> {
  if (!wantsChatFolder(input)) return input;
  if (!base) return { ...input, mode: 'chat' };
  const folder = await ensureChatWorkFolder(base, input.identity.threadId);
  return { ...input, projectRoots: [folder], chatFolder: true };
}

export async function keepChatFiles(
  db: Db,
  base: string | undefined,
  input: RunInput,
  lease: Lease,
): Promise<void> {
  if (!base || !input.chatFolder) return;
  await recordChatFiles({ db, base, conversationId: input.identity.threadId, lease }).catch(
    (error: unknown) => {
      if (error instanceof LeaseLostError) return;
      console.error('Could not keep the files this turn made', error);
    },
  );
}
