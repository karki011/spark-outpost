import type {
  InvolvementLevel,
  ModelRouting,
  ModelStat,
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

export { AdvisorError, AdvisorTimeoutError } from './jev-errors.ts';
