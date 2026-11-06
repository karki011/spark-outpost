import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inheritedEnvironment } from './inherited-env.ts';

export const ZAI_ANTHROPIC_BASE_URL = 'https://api.z.ai/api/anthropic';
export const ZAI_API_TIMEOUT_MS = '3000000';
export const ZAI_CONTEXT_WINDOW = '1000000';
export const ZAI_CONFIG_DIR = join(tmpdir(), 'spark-outpost-zai-claude');

export interface ZaiModel {
  slot: 'opus' | 'haiku';
  id: string;
  label: string;
  description: string;
  readsImages: boolean;
}

export const ZAI_MODELS: readonly ZaiModel[] = [
  {
    slot: 'opus',
    id: 'glm-5.3',
    label: 'GLM-5.3',
    readsImages: false,
    description:
      "Z.ai's strongest GLM for coding and agent work. Text only, 1M context, thinks on every turn. $1.40 in, $4.40 out per million tokens.",
  },
  {
    slot: 'haiku',
    id: 'glm-5.3-flash',
    label: 'GLM-5.3-Flash',
    readsImages: true,
    description:
      'Fast, cheap GLM that also reads images, 1M context. About a tenth of GLM-5.3: $0.15 in, $0.50 out per million tokens.',
  },
];

export const ZAI_EFFORTS = ['low', 'high', 'max'] as const;

const [MAIN_MODEL, FAST_MODEL] = ZAI_MODELS as [ZaiModel, ZaiModel];

const SLOT_MODELS: Readonly<Record<string, ZaiModel>> = {
  default: MAIN_MODEL,
  opus: MAIN_MODEL,
  sonnet: MAIN_MODEL,
  fable: MAIN_MODEL,
  haiku: FAST_MODEL,
};

export function zaiModelId(slot: string | null): string | null {
  if (slot === null) return null;
  return SLOT_MODELS[slot]?.id ?? slot.replace(/\[[^\]]*\]$/, '');
}

export function zaiModelFor(model: string | null): ZaiModel | null {
  const id = zaiModelId(model);
  return ZAI_MODELS.find((entry) => entry.id === id) ?? null;
}

function slotEnvironment(slot: string, model: ZaiModel): Record<string, string> {
  const name = `ANTHROPIC_DEFAULT_${slot}_MODEL`;
  return {
    [name]: `${model.id}[1m]`,
    [`${name}_NAME`]: model.label,
    [`${name}_DESCRIPTION`]: model.description,
  };
}

export function zaiEnvironment(
  parent: NodeJS.ProcessEnv,
  apiKey: string,
  configDir: string,
): Record<string, string> {
  return {
    ...inheritedEnvironment(parent),
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: ZAI_ANTHROPIC_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ...slotEnvironment('OPUS', MAIN_MODEL),
    ...slotEnvironment('SONNET', MAIN_MODEL),
    ...slotEnvironment('FABLE', MAIN_MODEL),
    ...slotEnvironment('HAIKU', FAST_MODEL),
    API_TIMEOUT_MS: ZAI_API_TIMEOUT_MS,
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: ZAI_CONTEXT_WINDOW,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

export async function zaiLaunchEnvironment(
  apiKey: string,
  configDir: string = ZAI_CONFIG_DIR,
): Promise<Record<string, string>> {
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  return zaiEnvironment(process.env, apiKey, configDir);
}
