import { z } from 'zod';

export const CUSTOM_ENDPOINT_URL_MAX = 2048;
export const CUSTOM_MODEL_NAME_MAX = 200;
export const CUSTOM_ENDPOINT_KEY_MAX = 512;

interface EndpointUrl {
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
  search: string;
  hash: string;
  username: string;
  password: string;
}

const UrlParser = (globalThis as unknown as { URL: new (value: string) => EndpointUrl }).URL;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MESSAGES_SUFFIX = /\/v1(?:\/messages)?$/i;

export type CustomEndpointUrl = { ok: true; baseUrl: string } | { ok: false; problem: string };

function parse(value: string): EndpointUrl | null {
  try {
    return new UrlParser(value);
  } catch {
    return null;
  }
}

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function customEndpointUrl(raw: string): CustomEndpointUrl {
  const value = raw.trim();
  if (!value)
    return { ok: false, problem: 'Type the server address, such as http://localhost:11434.' };
  if (value.length > CUSTOM_ENDPOINT_URL_MAX)
    return { ok: false, problem: 'This address is too long.' };
  const url = parse(value);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    return { ok: false, problem: 'Use an address that starts with https:// or http://.' };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      problem: 'Leave the login out of the address. Put a key in API key instead.',
    };
  }
  if (url.search !== '' || url.hash !== '' || value.includes('?') || value.includes('#')) {
    return { ok: false, problem: 'Leave out anything after ? or # in the address.' };
  }
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      problem: 'Use https:// for a server on another computer. http:// works only for localhost.',
    };
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (MESSAGES_SUFFIX.test(path)) {
    return { ok: false, problem: 'Leave out /v1 at the end. Spark adds /v1/messages itself.' };
  }
  return { ok: true, baseUrl: `${url.protocol}//${url.host}${path}` };
}

const MODEL_NAME = /^[^\s\p{Cc}]*$/u;
const MODEL_NAME_PROBLEM = 'Model names have no spaces.';

export const customModelNameSchema = z
  .string()
  .trim()
  .min(1, 'Type the model name your server uses.')
  .max(CUSTOM_MODEL_NAME_MAX)
  .regex(MODEL_NAME, MODEL_NAME_PROBLEM);

export const customEndpointSchema = z.object({
  baseUrl: z.string().transform((value, context) => {
    const result = customEndpointUrl(value);
    if (result.ok) return result.baseUrl;
    context.addIssue({ code: 'custom', message: result.problem });
    return z.NEVER;
  }),
  model: customModelNameSchema,
  fastModel: z.string().trim().max(CUSTOM_MODEL_NAME_MAX).regex(MODEL_NAME, MODEL_NAME_PROBLEM),
});
export type CustomEndpoint = z.infer<typeof customEndpointSchema>;

export function customEndpointProblem(fields: {
  baseUrl: string;
  model: string;
  fastModel: string;
}): string | null {
  const parsed = customEndpointSchema.safeParse(fields);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Check the fields.');
}
