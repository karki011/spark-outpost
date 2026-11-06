import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CUSTOM_ENDPOINT_KEY_MAX,
  customEndpointSchema,
  type CustomEndpoint,
  type ProviderModel,
} from '@spark-outpost/contracts';
import { ProviderError } from '../../providers/provider.ts';
import { inheritedEnvironment } from './inherited-env.ts';

export const CUSTOM_CONFIG_DIR = join(tmpdir(), 'spark-outpost-custom-claude');
export const CUSTOM_API_TIMEOUT_MS = '3000000';
export const CUSTOM_NO_KEY_TOKEN = 'spark-outpost-no-key';
export const CUSTOM_EFFORTS = ['low', 'high', 'max'] as const;
export const CUSTOM_SLOTS = ['opus', 'haiku'] as const;

const storedEndpointSchema = customEndpointSchema.extend({
  apiKey: z.string().max(CUSTOM_ENDPOINT_KEY_MAX),
});
export type StoredEndpoint = z.infer<typeof storedEndpointSchema>;

export function storedEndpointSecret(endpoint: CustomEndpoint, apiKey: string): string {
  return JSON.stringify({ ...endpoint, apiKey });
}

export function readStoredEndpoint(secret: string): StoredEndpoint {
  let raw: unknown;
  try {
    raw = JSON.parse(secret);
  } catch {
    raw = null;
  }
  const parsed = storedEndpointSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderError(
      'The custom endpoint settings in your keychain are unreadable. Connect the custom endpoint again in Settings.',
    );
  }
  return parsed.data;
}

export function endpointFastModel(endpoint: CustomEndpoint): string {
  return endpoint.fastModel || endpoint.model;
}

export function endpointModels(endpoint: CustomEndpoint): ProviderModel[] {
  return [
    { id: 'opus', label: endpoint.model },
    { id: 'haiku', label: endpointFastModel(endpoint) },
  ];
}

function slotEnvironment(slot: string, model: string, description: string) {
  const name = `ANTHROPIC_DEFAULT_${slot}_MODEL`;
  return {
    [name]: model,
    [`${name}_NAME`]: model,
    [`${name}_DESCRIPTION`]: description,
  };
}

const MAIN_DESCRIPTION = 'The main model on your custom endpoint.';
const FAST_DESCRIPTION = 'The model your custom endpoint uses for quick background work.';

export function customEndpointEnvironment(
  parent: NodeJS.ProcessEnv,
  endpoint: StoredEndpoint,
  configDir: string,
): Record<string, string> {
  return {
    ...inheritedEnvironment(parent),
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: endpoint.baseUrl,
    ANTHROPIC_AUTH_TOKEN: endpoint.apiKey || CUSTOM_NO_KEY_TOKEN,
    ...slotEnvironment('OPUS', endpoint.model, MAIN_DESCRIPTION),
    ...slotEnvironment('SONNET', endpoint.model, MAIN_DESCRIPTION),
    ...slotEnvironment('FABLE', endpoint.model, MAIN_DESCRIPTION),
    ...slotEnvironment('HAIKU', endpointFastModel(endpoint), FAST_DESCRIPTION),
    API_TIMEOUT_MS: CUSTOM_API_TIMEOUT_MS,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

export async function customEndpointLaunchEnvironment(
  secret: string,
  configDir: string = CUSTOM_CONFIG_DIR,
): Promise<Record<string, string>> {
  const endpoint = readStoredEndpoint(secret);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  return customEndpointEnvironment(process.env, endpoint, configDir);
}
