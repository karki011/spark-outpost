import type { z } from 'zod';
import { SERVICENOW_NAME, type ServiceNowAuthKind } from '@spark-outpost/contracts';
import { callJson, failure, isOk, type JsonAnswer, type JsonCall } from '../tickets/http.ts';
import { TicketApiError } from '../tickets/source.ts';

export interface ServiceNowAccess {
  instanceUrl: string;
  authKind: ServiceNowAuthKind;
  username: string;
  secret: string;
}

export interface ServiceNowRequest {
  method: JsonCall['method'];
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface ServiceNowClient {
  instanceUrl: string;
  raw(request: ServiceNowRequest): Promise<JsonAnswer>;
  call<T>(schema: z.ZodType<T>, request: ServiceNowRequest, action: string): Promise<T>;
}

export function serviceNowHeaders(access: ServiceNowAccess): Record<string, string> {
  if (access.authKind === 'api_key') return { 'x-sn-apikey': access.secret };
  const basic = Buffer.from(`${access.username}:${access.secret}`).toString('base64');
  return { authorization: `Basic ${basic}` };
}

export function tableUrl(instanceUrl: string, request: ServiceNowRequest): string {
  const url = new URL(request.path, instanceUrl);
  for (const [name, value] of Object.entries(request.query ?? {})) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

const isRedirect = (answer: JsonAnswer) =>
  answer.status === 0 || (answer.status >= 300 && answer.status < 400);

function redirected(instanceUrl: string): TicketApiError {
  return new TicketApiError(
    502,
    `${new URL(instanceUrl).host} sent Spark to another address. Spark sends your ServiceNow sign-in only to the instance itself, so it stopped. Check the instance address.`,
  );
}

export function serviceNowClient(
  access: ServiceNowAccess,
  fetchImpl: typeof fetch,
): ServiceNowClient {
  const headers = serviceNowHeaders(access);
  const raw = async (request: ServiceNowRequest) => {
    const answer = await callJson(fetchImpl, SERVICENOW_NAME, {
      method: request.method,
      url: tableUrl(access.instanceUrl, request),
      headers,
      redirect: 'manual',
      body: request.body,
      ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    });
    if (isRedirect(answer)) throw redirected(access.instanceUrl);
    return answer;
  };
  return {
    instanceUrl: access.instanceUrl,
    raw,
    async call(schema, request, action) {
      const answer = await raw(request);
      if (!isOk(answer)) throw failure(SERVICENOW_NAME, action, answer, 'record');
      const parsed = schema.safeParse(answer.data);
      if (!parsed.success) {
        throw new TicketApiError(
          502,
          `${SERVICENOW_NAME} sent an unexpected answer while ${action}.`,
        );
      }
      return parsed.data;
    },
  };
}
