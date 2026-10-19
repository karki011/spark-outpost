import type { z } from 'zod';
import { callJson, failure, isOk, type JsonAnswer, type JsonCall } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';

export interface AtlassianAccess {
  siteUrl: string;
  email: string;
  apiToken: string;
}

export interface AtlassianRequest {
  method: JsonCall['method'];
  path: string;
  body?: unknown;
  timeoutMs?: number;
}

export interface AtlassianClient {
  siteUrl: string;
  raw(request: AtlassianRequest): Promise<JsonAnswer>;
  call<T>(schema: z.ZodType<T> | null, request: AtlassianRequest, action: string): Promise<T>;
}

export function basicAuthorization(access: AtlassianAccess): string {
  return `Basic ${Buffer.from(`${access.email}:${access.apiToken}`).toString('base64')}`;
}

export function atlassianClient(
  access: AtlassianAccess,
  fetchImpl: typeof fetch,
  product: { name: string; thing: string },
): AtlassianClient {
  const authorization = basicAuthorization(access);
  const raw = (request: AtlassianRequest) =>
    callJson(fetchImpl, product.name, {
      method: request.method,
      url: `${access.siteUrl}${request.path}`,
      authorization,
      body: request.body,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });
  return {
    siteUrl: access.siteUrl,
    raw,
    async call(schema, request, action) {
      const answer = await raw(request);
      if (!isOk(answer)) throw failure(product.name, action, answer, product.thing);
      if (!schema) return undefined as never;
      const parsed = schema.safeParse(answer.data);
      if (!parsed.success) {
        throw new TicketApiError(502, `${product.name} sent an unexpected answer while ${action}.`);
      }
      return parsed.data;
    },
  };
}
