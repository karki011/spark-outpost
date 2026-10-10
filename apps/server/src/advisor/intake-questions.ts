import type { AdvisorCandidate, AdvisorOption } from './advice.ts';

const AGENT_DEFAULT_MODEL = 'default';

export function selectableModels(candidate: AdvisorCandidate): AdvisorOption[] {
  const models = candidate.models.filter((model) => model.id !== AGENT_DEFAULT_MODEL);
  return models.length > 0 ? models : candidate.models;
}

export { validNoul, type IntakeQuestions, type SystemOneResponse } from './jev-types.ts';
