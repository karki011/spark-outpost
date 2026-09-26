import type {
  IntakeAnswer,
  InvolvementLevel,
  ModelRouting,
  ProviderId,
  RunMode,
} from '@spark-outpost/contracts';

export interface AdvisorOption {
  id: string;
  label: string;
  description: string | null;
}

export interface AdvisorCandidate {
  provider: ProviderId;
  name: string;
  models: AdvisorOption[];
  efforts: AdvisorOption[];
}

export interface CurrentSettings {
  provider: string;
  model: string | null;
  modelLabel: string | null;
  effort: string | null;
}

export interface IntakeRequest {
  task: string;
  mode: RunMode;
  reposLinked: boolean;
  untrusted: string[];
  candidates: AdvisorCandidate[];
  current: CurrentSettings;
  level: InvolvementLevel;
  routing: ModelRouting;
}

export interface WorkSummary {
  madeBy: ProviderId;
  filesChanged: number;
  filesDeleted: number;
  checkRan: boolean;
}

export class AdvisorError extends Error {}

export class AdvisorTimeoutError extends AdvisorError {}

export const REVIEW_FILE_THRESHOLD = 3;

export function reviewSuggested(work: WorkSummary): boolean {
  return work.filesChanged > REVIEW_FILE_THRESHOLD || work.filesDeleted > 0 || !work.checkRan;
}

export function ruleAdvisor(request: IntakeRequest): IntakeAnswer {
  const doing = request.mode === 'do';
  return {
    intent: null,
    complexity: null,
    risk: doing ? 'edits' : 'read-only',
    injection: null,
    depth: doing ? 'execute' : 'direct',
    provider: request.current.provider,
    model: request.current.model,
    modelLabel: request.current.modelLabel,
    effort: request.current.effort,
  };
}
