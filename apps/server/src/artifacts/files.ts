import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARTIFACT_MAX_BYTES,
  ARTIFACT_TITLE_MAX,
  type ArtifactPageKind,
} from '@spark-outpost/contracts';
import { chatArtifactsFolder } from '../chat-files/folders.ts';

export class ArtifactContentError extends Error {}

export interface PreparedContent {
  text: string;
  bytes: number;
  sha256: string;
}

const SVG_START = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s/>]/i;

export function sha256Of(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

export function newViewKey(): string {
  return randomBytes(32).toString('hex');
}

export function cleanTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim().slice(0, ARTIFACT_TITLE_MAX);
  if (!clean) throw new ArtifactContentError('Give the artifact a title.');
  return clean;
}

export function prepareContent(
  kind: ArtifactPageKind,
  content: string,
  scrub: (text: string) => string,
): PreparedContent {
  const text = scrub(content);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes === 0) throw new ArtifactContentError('The artifact is empty.');
  if (bytes > ARTIFACT_MAX_BYTES) {
    throw new ArtifactContentError(
      `The artifact is ${bytes} bytes; the limit is ${ARTIFACT_MAX_BYTES} (2 MB).`,
    );
  }
  if (kind === 'svg' && !SVG_START.test(text)) {
    throw new ArtifactContentError('An svg artifact must be one <svg> document.');
  }
  return { text, bytes, sha256: sha256Of(text) };
}

function versionFile(base: string, conversationId: string, id: string, version: number): string {
  return join(chatArtifactsFolder(base, conversationId), id, String(version));
}

export async function writeVersionFile(
  base: string,
  conversationId: string,
  id: string,
  version: number,
  text: string,
): Promise<void> {
  const folder = join(chatArtifactsFolder(base, conversationId), id);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await writeFile(versionFile(base, conversationId, id, version), text, {
    mode: 0o600,
    flag: 'wx',
  });
}

export async function readVersionFile(
  base: string,
  stored: { conversationId: string; artifactId: string; version: number; sha256: string },
): Promise<string | null> {
  const path = versionFile(base, stored.conversationId, stored.artifactId, stored.version);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const data = await handle.readFile();
    return sha256Of(data) === stored.sha256 ? data.toString('utf8') : null;
  } finally {
    await handle.close();
  }
}
