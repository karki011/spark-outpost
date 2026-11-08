import type { NewSessionResponse, SessionConfigOption } from '@agentclientprotocol/sdk/unstable';
import { objectFields } from './object-fields.ts';

export const LEGACY_MODE_OPTION = 'spark-outpost/legacy-mode';
export const LEGACY_MODEL_OPTION = 'spark-outpost/legacy-model';

interface LegacyShape {
  optionId: string;
  category: string;
  currentKey: string;
  listKey: string;
  idKey: string;
}

const MODES: LegacyShape = {
  optionId: LEGACY_MODE_OPTION,
  category: 'mode',
  currentKey: 'currentModeId',
  listKey: 'availableModes',
  idKey: 'id',
};

const MODELS: LegacyShape = {
  optionId: LEGACY_MODEL_OPTION,
  category: 'model',
  currentKey: 'currentModelId',
  listKey: 'availableModels',
  idKey: 'modelId',
};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function legacyOption(state: unknown, shape: LegacyShape): SessionConfigOption | null {
  const fields = objectFields(state);
  const current = text(fields[shape.currentKey]);
  const list = fields[shape.listKey];
  if (current === null || !Array.isArray(list)) return null;
  const options = list.flatMap((entry) => {
    const item = objectFields(entry);
    const value = text(item[shape.idKey]);
    const name = text(item.name);
    if (value === null || name === null) return [];
    return [{ value, name, description: text(item.description) }];
  });
  return {
    id: shape.optionId,
    name: shape.category,
    category: shape.category,
    type: 'select',
    currentValue: current,
    options,
  };
}

export function legacyOptions(response: NewSessionResponse): SessionConfigOption[] {
  const fields = objectFields(response);
  return [legacyOption(fields.modes, MODES), legacyOption(fields.models, MODELS)].filter(
    (option) => option !== null,
  );
}

export function withLegacy(
  configOptions: readonly SessionConfigOption[],
  legacy: readonly SessionConfigOption[],
): SessionConfigOption[] {
  const offered = new Set(configOptions.map((option) => option.category));
  return [...configOptions, ...legacy.filter((option) => !offered.has(option.category))];
}

export function sessionOptions(response: NewSessionResponse): SessionConfigOption[] {
  return withLegacy(response.configOptions ?? [], legacyOptions(response));
}
