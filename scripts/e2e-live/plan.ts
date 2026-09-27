import type { BuildStyle, InvolvementLevel } from '../../packages/contracts/src/index.ts';
import { CORE_SCENARIOS, SCENARIOS, scenarioById, type ArmId, type Scenario } from './scenarios.ts';

export type Block = 'core' | 'scenarios' | 'versions' | 'configs' | 'models' | 'glm';
export const BLOCKS: readonly Block[] = [
  'core',
  'scenarios',
  'versions',
  'configs',
  'models',
  'glm',
];

export type Driver = 'ui' | 'api' | 'bench';
export type Placement = 'jev' | 'shared' | 'worktree';
export type ModelChoice = 'auto' | 'haiku' | 'sonnet' | 'opus[1m]';
export type Effort = 'low' | 'medium' | 'high';
export const VERSIONS = ['current', '2381803', '9a932f9'] as const;
export type Version = (typeof VERSIONS)[number];

export interface HarnessSetup {
  driver: Driver;
  provider: 'claude' | 'codex' | 'zai';
  level: InvolvementLevel;
  model: ModelChoice;
  buildStyle: BuildStyle;
  placement: Placement;
  jev: boolean;
  codexConnected: boolean;
  freshBeforeLastTurn: boolean;
  withDeps: boolean;
  version: Version;
}

export interface Cell {
  key: string;
  block: Block;
  variant: string;
  scenario: Scenario;
  arm: ArmId;
  setup: HarnessSetup;
  codexEffort: Effort;
  expectUsd: number;
}

export const BASELINE: HarnessSetup = {
  driver: 'ui',
  provider: 'claude',
  level: 'balanced',
  model: 'auto',
  buildStyle: 'off',
  placement: 'jev',
  jev: true,
  codexConnected: true,
  freshBeforeLastTurn: false,
  withDeps: false,
  version: 'current',
};

const MODEL_COST: Record<ModelChoice, number> = {
  auto: 1,
  haiku: 0.35,
  sonnet: 0.85,
  'opus[1m]': 2.3,
};
const EFFORT_COST: Record<Effort, number> = { low: 0.6, medium: 1, high: 1.6 };

function cost(scenario: Scenario, arm: ArmId, setup: HarnessSetup, effort: Effort): number {
  const base = scenario.expectUsd[arm];
  if (arm === 'direct-codex') return base * EFFORT_COST[effort];
  if (arm === 'direct-claude') return base;
  const lean = setup.buildStyle === 'lean' ? 0.95 : 1;
  const critic = setup.codexConnected ? 1 : 1.1;
  const glm = setup.provider === 'zai' ? 0.45 : setup.provider === 'codex' ? 0.8 : 1;
  const rules = setup.jev ? 1 : 1.05;
  return base * MODEL_COST[setup.model] * lean * critic * rules * glm;
}

function cell(
  block: Block,
  scenarioId: string,
  arm: ArmId,
  variant = 'baseline',
  change: Partial<HarnessSetup> = {},
  codexEffort: Effort = 'medium',
): Cell {
  const scenario = scenarioById(scenarioId);
  const setup = { ...BASELINE, ...change };
  return {
    key: `${block}:${scenarioId}:${arm}:${variant}`,
    block,
    variant,
    scenario,
    arm,
    setup,
    codexEffort,
    expectUsd: cost(scenario, arm, setup, codexEffort),
  };
}

function allArms(block: Block, scenario: Scenario, change: Partial<HarnessSetup> = {}): Cell[] {
  return (['harness', 'direct-claude', 'direct-codex'] as const).map((arm) =>
    cell(block, scenario.id, arm, 'baseline', arm === 'harness' ? change : {}),
  );
}

function coreCells(): Cell[] {
  return [
    ...CORE_SCENARIOS.filter((scenario) => scenario.id !== 'j').flatMap((scenario) =>
      allArms('core', scenario, scenario.id === 'd' ? { withDeps: true } : {}),
    ),
    cell('core', 'd', 'harness', 'shared', {
      driver: 'bench',
      placement: 'shared',
      withDeps: true,
    }),
    cell('core', 'd', 'harness', 'worktree', {
      driver: 'bench',
      placement: 'worktree',
      withDeps: true,
    }),
    cell('core', 'h', 'harness', 'lean', { buildStyle: 'lean' }),
    cell('core', 'i', 'harness', 'fresh', { freshBeforeLastTurn: true }),
    cell('core', 'j', 'harness', 'claude-builder'),
    cell('core', 'j', 'harness', 'codex-builder', { driver: 'api', provider: 'codex' }),
  ];
}

function scenarioCells(): Cell[] {
  const more = SCENARIOS.filter((scenario) => !CORE_SCENARIOS.includes(scenario));
  return more.flatMap((scenario) => {
    if (scenario.id === 's') return [cell('scenarios', 's', 'harness')];
    if (scenario.id === 't') {
      return [
        cell('scenarios', 't', 'harness', 'worktree', { driver: 'bench', placement: 'worktree' }),
        cell('scenarios', 't', 'direct-claude'),
        cell('scenarios', 't', 'direct-codex'),
      ];
    }
    return allArms('scenarios', scenario);
  });
}

const VERSION_SCENARIOS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

function versionCells(): Cell[] {
  return VERSIONS.filter((version) => version !== 'current').flatMap((version) =>
    VERSION_SCENARIOS.map((id) =>
      cell('versions', id, 'harness', version, { driver: 'api', version }),
    ),
  );
}

function configCells(): Cell[] {
  const levels = (['hands-on', 'full-auto'] as const).flatMap((level) =>
    ['b', 'c', 'f'].map((id) => cell('configs', id, 'harness', `level-${level}`, { level })),
  );
  const lean = ['c', 'd'].map((id) =>
    cell('configs', id, 'harness', 'lean', { buildStyle: 'lean', withDeps: id === 'd' }),
  );
  const rules = ['a', 'c', 'd', 'e'].map((id) =>
    cell('configs', id, 'harness', 'rules-only', {
      jev: false,
      model: 'sonnet',
      withDeps: id === 'd',
    }),
  );
  const claudeCritic = ['e', 'f', 'j'].map((id) =>
    cell('configs', id, 'harness', 'claude-critic', { codexConnected: false }),
  );
  const array = [
    cell('configs', 'f', 'harness', 'l4-jev-lean-claude', {
      buildStyle: 'lean',
      codexConnected: false,
    }),
    cell('configs', 'f', 'harness', 'l4-rules-off-claude', {
      jev: false,
      model: 'sonnet',
      codexConnected: false,
    }),
    cell('configs', 'f', 'harness', 'l4-rules-lean-codex', {
      jev: false,
      model: 'sonnet',
      buildStyle: 'lean',
    }),
  ];
  const pinnedControls = ['a', 'd', 'f'].map((id) =>
    cell('configs', id, 'harness', 'jev-pinned-sonnet', { model: 'sonnet', withDeps: id === 'd' }),
  );
  return [...levels, ...lean, ...rules, ...pinnedControls, ...claudeCritic, ...array];
}

const MODEL_SCENARIOS = ['b', 'c', 'e', 'g'];

function modelCells(): Cell[] {
  const claude = (['haiku', 'sonnet', 'opus[1m]'] as const).flatMap((model) =>
    MODEL_SCENARIOS.map((id) => cell('models', id, 'harness', `pinned-${model}`, { model })),
  );
  const codex = (['low', 'high'] as const).flatMap((effort) =>
    MODEL_SCENARIOS.map((id) => cell('models', id, 'direct-codex', `codex-${effort}`, {}, effort)),
  );
  const codexBuilder = ['b', 'c', 'g'].map((id) =>
    cell('models', id, 'harness', 'codex-builder', { driver: 'api', provider: 'codex' }),
  );
  return [...claude, ...codex, ...codexBuilder];
}

function glmCells(): Cell[] {
  const glm = { driver: 'api', provider: 'zai' } as const;
  return [
    ...['b', 'c', 'g'].map((id) => cell('glm', id, 'harness', 'glm-builder', glm)),
    cell('glm', 'e', 'harness', 'glm-builder-claude-critic', { ...glm, codexConnected: false }),
  ];
}

export function planCells(): Cell[] {
  return [
    ...coreCells(),
    ...scenarioCells(),
    ...versionCells(),
    ...configCells(),
    ...modelCells(),
    ...glmCells(),
  ];
}
