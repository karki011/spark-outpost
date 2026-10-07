import type {
  IntakeAnswer,
  InvolvementLevel,
  ModelRouting,
  ModelStat,
  ProviderId,
  RunMode,
} from '@spark-outpost/contracts';
import { intentByRule } from '../orchestration/intent-rules.ts';

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
  doAvailable?: boolean;
  stats?: readonly ModelStat[];
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
  firstMessage: boolean;
  currentTask: { previousRequest: string; summary: string } | null;
  previousReply?: string | null;
  fourWay?: boolean;
}

export class AdvisorError extends Error {}

export class AdvisorTimeoutError extends AdvisorError {}

export function ruleAdvisor(request: IntakeRequest): IntakeAnswer {
  const doing = request.mode === 'do';
  return {
    intent: doing ? intentByRule(request.task, request.mode) : null,
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
