import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function localPath(posixPath: string): string {
  return path.resolve(posixPath);
}

export function fileUrl(posixPath: string): string {
  return pathToFileURL(localPath(posixPath)).href;
}
