import { zaiModelFor, zaiModelId } from '../agents/acp/zai.ts';

export interface ReportedModel {
  model: string | null;
  modelLabel?: string;
}

export function reportedModel(provider: string | null, model: string | null): ReportedModel {
  if (provider !== 'zai') return { model };
  const known = zaiModelFor(model);
  return known ? { model: known.id, modelLabel: known.label } : { model: zaiModelId(model) };
}
