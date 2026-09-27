export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['png', 'jpg', 'jpeg'];

export interface StoredUpload {
  storedName: string;
  extension: string;
}

export function acceptUpload(name: string, size: number, id: string): StoredUpload {
  if (!Number.isInteger(size) || size <= 0) throw new Error('The file is empty.');
  if (size > MAX_UPLOAD_BYTES) throw new Error('The file is too large.');
  if (name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new Error('The file name is not allowed.');
  }
  const parts = name.toLowerCase().split('.');
  if (parts.length !== 2 || parts[0] === '') throw new Error('The file name is not allowed.');
  const extension = parts[1]!;
  if (!ALLOWED.includes(extension)) throw new Error('This file type is not allowed.');
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('The upload id is not valid.');
  return { storedName: `${id}.${extension}`, extension };
}
