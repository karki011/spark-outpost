import { z } from 'zod';

export const SERVICENOW_NAME = 'ServiceNow';

export const serviceNowTypeIdSchema = z.enum(['incident', 'request', 'change', 'problem']);
export type ServiceNowTypeId = z.infer<typeof serviceNowTypeIdSchema>;

export const serviceNowTypeNames: Record<ServiceNowTypeId, string> = {
  incident: 'Incidents',
  request: 'Requests and tasks',
  change: 'Changes',
  problem: 'Problems',
};

export const serviceNowTableSchema = z.enum([
  'incident',
  'sc_req_item',
  'sc_task',
  'change_request',
  'problem',
]);
export type ServiceNowTable = z.infer<typeof serviceNowTableSchema>;

export const serviceNowTableNames: Record<ServiceNowTable, string> = {
  incident: 'Incident',
  sc_req_item: 'Requested item',
  sc_task: 'Catalog task',
  change_request: 'Change',
  problem: 'Problem',
};

export const SERVICENOW_READ_ONLY_TABLES: readonly ServiceNowTable[] = ['change_request'];

export function isReadOnlyTable(table: string | null): boolean {
  return SERVICENOW_READ_ONLY_TABLES.some((entry) => entry === table);
}

export const serviceNowTables: Record<ServiceNowTypeId, readonly ServiceNowTable[]> = {
  incident: ['incident'],
  request: ['sc_req_item', 'sc_task'],
  change: ['change_request'],
  problem: ['problem'],
};

export const serviceNowAuthKindSchema = z.enum(['basic', 'api_key']);
export type ServiceNowAuthKind = z.infer<typeof serviceNowAuthKindSchema>;

export const serviceNowReachSchema = z.enum(['reachable', 'denied', 'unchecked']);
export type ServiceNowReach = z.infer<typeof serviceNowReachSchema>;

export const serviceNowTypeSchema = z.object({ on: z.boolean(), reach: serviceNowReachSchema });
export type ServiceNowType = z.infer<typeof serviceNowTypeSchema>;

export const serviceNowTypesSchema = z.record(serviceNowTypeIdSchema, serviceNowTypeSchema);
export type ServiceNowTypes = z.infer<typeof serviceNowTypesSchema>;

export const serviceNowInboxScopeSchema = z.enum(['me', 'groups']);
export type ServiceNowInboxScope = z.infer<typeof serviceNowInboxScopeSchema>;

export const serviceNowConnectionSchema = z.object({
  authKind: serviceNowAuthKindSchema,
  login: z.string(),
  types: serviceNowTypesSchema,
  inboxScope: serviceNowInboxScopeSchema.default('groups'),
});
export type ServiceNowConnection = z.infer<typeof serviceNowConnectionSchema>;

export function serviceNowTypeLive(type: ServiceNowType | undefined): boolean {
  return type?.on === true && type.reach === 'reachable';
}

const BARE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ADDRESS =
  /^(?:(https?):\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+|localhost|\[::1\])(:\d{1,5})?$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function serviceNowInstanceUrl(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/\/+$/, '');
  if (BARE_NAME.test(value)) return `https://${value}.service-now.com`;
  const match = ADDRESS.exec(value);
  if (!match) return null;
  const [, scheme = 'https', host = '', port = ''] = match;
  if (port && Number(port.slice(1)) > 65_535) return null;
  if (scheme === 'http' && !LOOPBACK.has(host)) return null;
  return `${scheme}://${host}${port}`;
}

export const serviceNowInstanceSchema = z
  .string()
  .trim()
  .min(1, 'Type your instance name, such as acme.')
  .max(300)
  .transform((value, context) => {
    const url = serviceNowInstanceUrl(value);
    if (url) return url;
    context.addIssue({
      code: 'custom',
      message: 'Use your instance name, such as acme, or its https address with nothing after it.',
    });
    return z.NEVER;
  });

export const serviceNowUsernameSchema = z
  .string()
  .trim()
  .min(1, 'Type your ServiceNow user name.')
  .max(100)
  .regex(/^[^\s^=]+$/, 'Use your ServiceNow user name, without spaces.');
