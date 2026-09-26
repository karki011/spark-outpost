import type { ConnectableId, ProviderModel } from '@spark-outpost/contracts';

const CLAUDE_FAMILIES = ['Opus', 'Sonnet', 'Haiku'];
const OPENAI_TEXT_MODEL = /^(gpt-|o\d|codex)/;
const OPENAI_NON_TEXT = /(audio|realtime|tts|transcribe|image|search|embedding|moderation)/;

interface ListedModel {
  id?: unknown;
  display_name?: unknown;
}

interface TypeSafeModel {
  name?: unknown;
}

function parseTypeSafeModels(payload: unknown): ProviderModel[] {
  const models =
    payload && typeof payload === 'object' && 'models' in payload && Array.isArray(payload.models)
      ? (payload.models as TypeSafeModel[])
      : [];
  return models
    .filter((item): item is { name: string } => typeof item.name === 'string')
    .map((item) => ({ id: item.name, label: item.name }));
}

export function parseModels(provider: ConnectableId, payload: unknown): ProviderModel[] {
  if (provider === 'jev') return parseTypeSafeModels(payload);
  const data =
    payload && typeof payload === 'object' && 'data' in payload && Array.isArray(payload.data)
      ? (payload.data as ListedModel[])
      : [];
  const models = data
    .filter((item): item is { id: string; display_name?: unknown } => typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      label: typeof item.display_name === 'string' ? item.display_name : item.id,
    }));
  if (provider === 'claude') return models;
  return models.filter(
    (model) => OPENAI_TEXT_MODEL.test(model.id) && !OPENAI_NON_TEXT.test(model.id),
  );
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

export function modelSummary(provider: ConnectableId, models: ProviderModel[]): string {
  const count = `${models.length} ${models.length === 1 ? 'model is' : 'models are'} available`;
  if (provider === 'claude') {
    const families = CLAUDE_FAMILIES.filter((family) =>
      models.some((model) => model.label.includes(family)),
    );
    if (families.length > 0) {
      return `${joinWithAnd(families)} ${families.length === 1 ? 'is' : 'are'} available`;
    }
    return count;
  }
  const examples = models.slice(0, 2).map((model) => model.id);
  return examples.length ? `${count}, including ${joinWithAnd(examples)}` : count;
}
