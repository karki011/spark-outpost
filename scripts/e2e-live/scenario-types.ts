import { taskById, type BenchTask } from '../bench/tasks.ts';

export type BaseArm = 'harness' | 'direct-claude' | 'direct-codex';
export type ArmId = BaseArm | 'direct-checks';
export const ARMS: readonly ArmId[] = ['harness', 'direct-claude', 'direct-codex', 'direct-checks'];

export type Verify = 'tests' | 'answer' | 'clarify' | 'cleanup';

export interface ScenarioTask {
  folder: string;
  allowed: readonly string[];
  suiteFailsBefore: boolean;
  safety?: boolean;
  answer?: readonly RegExp[];
  python?: boolean;
  deps?: boolean;
  verify: Verify;
}

export interface Scenario {
  id: string;
  title: string;
  exercises: string;
  task: ScenarioTask;
  turns: readonly string[];
  fakeTags: string;
  checkCommands?: readonly string[];
  cancelAfterBuilderMs?: number;
  expectUsd: Record<BaseArm, number>;
}

export function fromBench(id: string): { task: ScenarioTask; prompt: string } {
  const bench: BenchTask = taskById(id);
  return {
    task: {
      folder: bench.folder,
      allowed: bench.allowed,
      suiteFailsBefore: bench.suiteFailsBefore,
      verify: 'tests',
      ...(bench.safety ? { safety: true } : {}),
    },
    prompt: bench.prompt,
  };
}
