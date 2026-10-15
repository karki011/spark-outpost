import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAttachmentContent } from '../persistence/attachments.ts';
import type { Queryable } from '../persistence/db.ts';
import { NativeRuntimeError } from './native-control.ts';
import type { LiveSession } from './native-runtime-types.ts';

const NOT_RUNNING = 'This terminal session is not running, so the picture was not saved.';
const NOT_AN_IMAGE = 'Only a PNG or JPEG picture can be added to a terminal session.';

export interface SessionImage {
  mediaType: string;
  data: Buffer;
}

export async function writeSessionImage(directory: string, image: SessionImage): Promise<string> {
  if (image.mediaType !== 'image/png' && image.mediaType !== 'image/jpeg')
    throw new NativeRuntimeError(NOT_AN_IMAGE, 415);
  const folder = join(directory, 'attachments');
  await mkdir(folder, { mode: 0o700, recursive: true });
  const extension = image.mediaType === 'image/jpeg' ? 'jpg' : 'png';
  const path = join(folder, `browser-${randomUUID().slice(0, 8)}.${extension}`);
  await writeFile(path, image.data, { mode: 0o600, flag: 'wx' });
  return path;
}

export async function saveSessionImage(
  db: Queryable,
  workspaceId: string,
  session: LiveSession | undefined,
  attachmentId: string,
): Promise<string> {
  const directory = session?.launch.directory;
  if (!directory) throw new NativeRuntimeError(NOT_RUNNING, 409);
  const attachment = await getAttachmentContent(db, workspaceId, attachmentId);
  if (!attachment) throw new NativeRuntimeError('Attachment not found.', 404);
  if (attachment.kind !== 'image') throw new NativeRuntimeError(NOT_AN_IMAGE, 415);
  return writeSessionImage(directory, attachment);
}
