import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function chatFoldersBase(dataDir: string, channel: string): string {
  return join(dataDir, channel, 'chats');
}

function chatHome(base: string, conversationId: string): string {
  if (!UUID.test(conversationId)) throw new Error('A chat folder needs a chat id.');
  return join(base, conversationId);
}

export function chatWorkFolder(base: string, conversationId: string): string {
  return join(chatHome(base, conversationId), 'work');
}

export function chatKeptFolder(base: string, conversationId: string): string {
  return join(chatHome(base, conversationId), 'kept');
}

export function isChatWorkFolder(base: string, folder: string): boolean {
  const parts = relative(resolve(base), resolve(folder)).split(sep);
  return parts.length === 2 && UUID.test(parts[0] ?? '') && parts[1] === 'work';
}

export async function ensureChatWorkFolder(base: string, conversationId: string): Promise<string> {
  const folder = chatWorkFolder(base, conversationId);
  await mkdir(base, { recursive: true, mode: 0o700 });
  await mkdir(chatHome(base, conversationId), { recursive: true, mode: 0o700 });
  await mkdir(folder, { recursive: true, mode: 0o700 });
  return folder;
}

export async function removeChatFolder(base: string, conversationId: string): Promise<void> {
  await rm(chatHome(base, conversationId), { recursive: true, force: true });
}

export async function chatFolderIds(base: string): Promise<string[]> {
  const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => entry.name);
}
