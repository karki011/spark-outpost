import type { Request } from 'express';
import { z } from 'zod';

export class BadRequestError extends Error {}

export class UploadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Files must be ${limitBytes / (1024 * 1024)} MB or smaller.`);
  }
}

export class RequestTooLargeError extends Error {}

export function isTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.too.large'
  );
}

export function parseBody<T>(schema: z.ZodType<T>, req: Request): T {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || 'body').join(', ');
    throw new BadRequestError(`Invalid request: ${fields}.`);
  }
  return result.data;
}

const idParam = z.uuid();

export function paramId(req: Request, name = 'id'): string {
  const result = idParam.safeParse(req.params[name]);
  if (!result.success) throw new BadRequestError('The id must be a UUID.');
  return result.data;
}
