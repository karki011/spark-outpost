import { failure, isOk } from '../tickets/http.ts';
import { adfToText, textToAdf } from '../tickets/jira-adf.ts';
import { TicketApiError } from '../tickets/source.ts';
import type { AtlassianClient } from './access.ts';
import { projectIssueTypes } from './jira-hierarchy.ts';
import { resolveUser, type UserContext } from './jira-users.ts';

export interface JiraAllowed {
  id: string | null;
  label: string;
}

export interface JiraFieldMeta {
  id: string;
  name: string;
  type: string;
  items: string | null;
  custom: string | null;
  required: boolean;
  allowed: JiraAllowed[] | null;
}

const TEXT_MAX = 300;
const ALLOWED_SHOWN = 50;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function allowedOf(values: unknown): JiraAllowed[] | null {
  if (!Array.isArray(values)) return null;
  return values.flatMap((value) => {
    const entry = record(value);
    if (!entry) return [];
    const label =
      text(entry.name) ?? text(entry.value) ?? text(entry.key) ?? text(entry.displayName);
    if (!label) return [];
    return [{ id: text(entry.id), label }];
  });
}

function metaOf(id: string, raw: unknown): JiraFieldMeta | null {
  const field = record(raw);
  const schema = record(field?.schema);
  const name = text(field?.name);
  if (!field || !schema || !name) return null;
  return {
    id,
    name,
    type: text(schema.type) ?? 'any',
    items: text(schema.items),
    custom: text(schema.custom),
    required: field.required === true,
    allowed: allowedOf(field.allowedValues),
  };
}

export function editMetaFields(data: unknown): JiraFieldMeta[] {
  const fields = record(record(data)?.fields);
  if (!fields) return [];
  return Object.entries(fields).flatMap(([id, raw]) => metaOf(id, raw) ?? []);
}

export function createMetaFields(data: unknown): JiraFieldMeta[] {
  const body = record(data);
  const list = body?.fields ?? body?.results ?? body?.values;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw) => {
    const id = text(record(raw)?.fieldId) ?? text(record(raw)?.key);
    return id ? (metaOf(id, raw) ?? []) : [];
  });
}

export async function editMeta(client: AtlassianClient, key: string): Promise<JiraFieldMeta[]> {
  const answer = await client.raw({
    method: 'GET',
    path: `/rest/api/3/issue/${encodeURIComponent(key)}/editmeta`,
  });
  if (!isOk(answer)) throw failure('Jira', `reading the fields of ${key}`, answer);
  return editMetaFields(answer.data);
}

export async function createMeta(
  client: AtlassianClient,
  project: string,
  typeName: string,
): Promise<JiraFieldMeta[]> {
  const types = await projectIssueTypes(client, project);
  const type = types.find((entry) => entry.name.toLowerCase() === typeName.toLowerCase());
  if (!type?.id) {
    const names = types.map((entry) => entry.name).join(', ');
    throw new TicketApiError(400, `${project} has no issue type "${typeName}"; it has ${names}.`);
  }
  const path = `/rest/api/3/issue/createmeta/${encodeURIComponent(project)}/issuetypes/${type.id}?maxResults=200`;
  const answer = await client.raw({ method: 'GET', path });
  if (!isOk(answer))
    throw failure('Jira', `reading the fields of ${typeName} in ${project}`, answer);
  return createMetaFields(answer.data);
}

export function shownMeta(meta: JiraFieldMeta) {
  return {
    id: meta.id,
    name: meta.name,
    type: meta.items ? `${meta.type} of ${meta.items}` : meta.type,
    ...(meta.required ? { required: true } : {}),
    ...(meta.allowed
      ? { allowed: meta.allowed.slice(0, ALLOWED_SHOWN).map((value) => value.label) }
      : {}),
  };
}

export function findField(metas: readonly JiraFieldMeta[], wanted: string): JiraFieldMeta {
  const exact = metas.find((meta) => meta.id === wanted);
  if (exact) return exact;
  const named = metas.filter((meta) => meta.name.toLowerCase() === wanted.toLowerCase());
  if (named.length === 1) return named[0]!;
  if (named.length > 1) {
    const ids = named.map((meta) => meta.id).join(', ');
    throw new TicketApiError(400, `Several fields are named "${wanted}" (${ids}). Pass the id.`);
  }
  throw new TicketApiError(
    400,
    `"${wanted}" isn't a field Jira lets you set here. Nothing was changed; list them with spark_jira fields.`,
  );
}

export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.slice(0, TEXT_MAX);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value))
    return value.map(fieldText).filter(Boolean).join(', ').slice(0, TEXT_MAX);
  const entry = record(value)!;
  if (entry.type === 'doc') return adfToText(entry).slice(0, TEXT_MAX);
  const named =
    text(entry.displayName) ??
    text(entry.name) ??
    text(entry.value) ??
    text(entry.key) ??
    text(entry.title) ??
    text(entry.originalEstimate);
  return (named ?? JSON.stringify(value)).slice(0, TEXT_MAX);
}

function refuse(meta: JiraFieldMeta, why: string): never {
  throw new TicketApiError(400, `${meta.name} (${meta.id}): ${why}. Nothing was changed.`);
}

function pickAllowed(meta: JiraFieldMeta, value: unknown): JiraAllowed | null {
  if (typeof value !== 'string' || !meta.allowed) return null;
  const found = meta.allowed.find(
    (entry) => entry.id === value || entry.label.toLowerCase() === value.toLowerCase(),
  );
  if (found) return found;
  const choices = meta.allowed
    .slice(0, 20)
    .map((entry) => entry.label)
    .join(', ');
  return refuse(meta, `"${value}" isn't allowed; choose from ${choices}`);
}

const NAMED = new Set([
  'priority',
  'resolution',
  'issuetype',
  'version',
  'component',
  'securitylevel',
  'project',
]);

function namedValue(meta: JiraFieldMeta, type: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const allowed = pickAllowed(meta, value);
  if (allowed?.id) return { id: allowed.id };
  if (type === 'option') return { value };
  return { name: value };
}

async function single(
  meta: JiraFieldMeta,
  type: string,
  value: unknown,
  users: UserLookup,
): Promise<unknown> {
  if (value === null) return null;
  if (type === 'string') {
    if (typeof value !== 'string') refuse(meta, 'pass text');
    const rich =
      meta.custom?.endsWith(':textarea') || ['description', 'environment'].includes(meta.id);
    return rich ? textToAdf(value) : value;
  }
  if (type === 'number') {
    const number = typeof value === 'string' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) refuse(meta, 'pass a number');
    return number;
  }
  if (type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      refuse(meta, 'pass a date like 2026-12-31');
    return value;
  }
  if (type === 'datetime') {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
      refuse(meta, 'pass a date and time');
    return value;
  }
  if (type === 'user') {
    if (typeof value !== 'string') return value;
    const user = await users(value);
    return user ? { accountId: user.accountId } : null;
  }
  if (type === 'option' || NAMED.has(type)) return namedValue(meta, type, value);
  return value;
}

export type UserLookup = (wanted: string) => ReturnType<typeof resolveUser>;

export function userLookup(client: AtlassianClient, context: UserContext): UserLookup {
  return (wanted) => resolveUser(client, wanted, context);
}

export async function fieldValue(
  meta: JiraFieldMeta,
  value: unknown,
  users: UserLookup,
): Promise<unknown> {
  if (value === null && meta.required) refuse(meta, 'it is required and cannot be cleared');
  if (meta.type !== 'array') return single(meta, meta.type, value, users);
  if (value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return Promise.all(list.map((entry) => single(meta, meta.items ?? 'any', entry, users)));
}
