import type { BuildStyle, InvolvementLevel } from '../../packages/contracts/src/index.ts';
import { CORE_SCENARIOS, SCENARIOS, scenarioById, type ArmId, type Scenario } from './scenarios.ts';

export type Block =
  | 'core'
  | 'scenarios'
  | 'versions'
  | 'configs'
  | 'models'
  | 'glm'
  | 'focus'
  | 'lean'
  | 'routing'
  | 'dev-day';
export const BLOCKS: readonly Block[] = [
  'core',
  'scenarios',
  'versions',
  'configs',
  'models',
  'glm',
  'focus',
  'lean',
  'routing',
  'dev-day',
];

export type Driver = 'ui' | 'api' | 'bench';
export type ModelChoice = 'auto' | 'haiku' | 'sonnet' | 'opus[1m]';
export type Effort = 'low' | 'medium' | 'high';
export const VERSIONS = ['current', '2381803', '9a932f9', 'd87e633'] as const;
export type Version = (typeof VERSIONS)[number];

export interface HarnessSetup {
  driver: Driver;
  provider: 'claude' | 'codex' | 'zai';
  level: InvolvementLevel;
  model: ModelChoice;
  buildStyle: BuildStyle;
  jev: boolean;
  codexConnected: boolean;
  zaiConnected: boolean;
  freshBeforeLastTurn: boolean;
  withDeps: boolean;
  version: Version;
  /** With Auto routing: the chat's model, so the rule route (chat model) lands there. */
  chatModel?: ModelChoice;
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
  jev: true,
  codexConnected: true,
  zaiConnected: false,
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
  if (arm === 'direct-checks') return scenario.expectUsd['direct-claude'] * 1.15;
  const base = scenario.expectUsd[arm];
  if (arm === 'direct-codex') return base * EFFORT_COST[effort];
  if (arm === 'direct-claude') return base;
  const lean = setup.buildStyle === 'lean' ? 0.95 : 1;
  const critic = setup.codexConnected ? 1 : 1.1;
  const glm = setup.provider === 'zai' ? 0.45 : setup.provider === 'codex' ? 0.8 : 1;
  const rules = setup.jev ? 1 : 1.05;
  const chat = setup.chatModel ? MODEL_COST[setup.chatModel] / MODEL_COST.sonnet : 1;
  return base * MODEL_COST[setup.model] * lean * critic * rules * glm * chat;
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
    cell('core', 'd', 'harness', 'bench', { driver: 'bench', withDeps: true }),
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
        cell('scenarios', 't', 'harness', 'bench', { driver: 'bench' }),
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
  const levels = (['balanced', 'full-auto'] as const).flatMap((level) =>
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
  const glm = { driver: 'api', provider: 'zai', zaiConnected: true } as const;
  return [
    ...['b', 'c', 'g'].map((id) => cell('glm', id, 'harness', 'glm-builder', glm)),
    cell('glm', 'e', 'harness', 'glm-builder-claude-critic', { ...glm, codexConnected: false }),
  ];
}

const PLANNED = ['c', 'd', 'f', 'l', 'q', 'r', 't', 'g'];

function focusCells(): Cell[] {
  const ab = PLANNED.map((id) =>
    cell('focus', id, 'harness', 'bench', { driver: 'bench', withDeps: id === 'd' }),
  );
  const drift = ['c', 'q'].map((id) => cell('focus', id, 'direct-claude', 'drift-check'));
  const regression = [
    cell('focus', 'n', 'harness', 'regression'),
    cell('focus', 'e', 'harness', 'regression'),
    cell('focus', 'i', 'harness', 'regression'),
    cell('focus', 'j', 'harness', 'regression-codex-builder', { driver: 'api', provider: 'codex' }),
    cell('focus', 'd', 'harness', 'regression', { withDeps: true }),
  ];
  const glm = [
    ...['c', 'g'].map((id) =>
      cell('focus', id, 'harness', 'glm-builder', {
        driver: 'api',
        provider: 'zai',
        zaiConnected: true,
      }),
    ),
    cell('focus', 'c', 'harness', 'auto-three-providers', { zaiConnected: true }),
  ];
  return [...ab, ...drift, ...regression, ...glm];
}

const ROUND5 = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
];

function leanCells(): Cell[] {
  const deps = (id: string) => (id === 'd' ? { withDeps: true } : {});
  const lean = ROUND5.map((id) => cell('lean', id, 'harness', 'lean', deps(id)));
  const full = ROUND5.filter((id) => id !== 's').map((id) =>
    cell('lean', id, 'harness', 'full-d87e633', { driver: 'api', version: 'd87e633', ...deps(id) }),
  );
  const checked = ROUND5.filter((id) => id !== 'j' && id !== 's').map((id) =>
    cell('lean', id, 'direct-checks', 'direct-checks'),
  );
  const drift = ['c', 'q'].map((id) => cell('lean', id, 'direct-claude', 'drift-check'));
  const extra = [
    cell('lean', 'j', 'harness', 'lean-codex-builder', { driver: 'api', provider: 'codex' }),
    ...['c', 'g'].map((id) =>
      cell('lean', id, 'harness', 'lean-glm-builder', {
        driver: 'api',
        provider: 'zai',
        zaiConnected: true,
      }),
    ),
  ];
  return [...lean, ...full, ...checked, ...drift, ...extra];
}

/** Scenarios whose point is routing a coding task (not a question, Stop, or clarify). */
export const ROUTING_SCENARIOS = [
  'b',
  'c',
  'd',
  'e',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'o',
  'p',
  'q',
  'r',
  't',
];
const ROUTING_CHATS: Record<string, ModelChoice> = {
  rule: 'sonnet',
  'chat-haiku': 'haiku',
  'chat-opus': 'opus[1m]',
};

/**
 * Live routing comparison: Claude only (no Codex, so the Critic is Claude), API driver at
 * Balanced, Auto routing. `rule` is the rule route with Sonnet as the chat model; the
 * `chat-*` variants move the chat model so the rule route runs the Builder on that model.
 */
function routingCells(): Cell[] {
  return Object.entries(ROUTING_CHATS).flatMap(([variant, chatModel]) =>
    ROUTING_SCENARIOS.map((id) =>
      cell('routing', id, 'harness', variant, {
        driver: 'api',
        codexConnected: false,
        chatModel,
        withDeps: id === 'd',
      }),
    ),
  );
}

export function planCells(): Cell[] {
  return [
    ...routingCells(),
    ...leanCells(),
    ...focusCells(),
    ...coreCells(),
    ...scenarioCells(),
    ...versionCells(),
    ...configCells(),
    ...modelCells(),
    ...glmCells(),
  ];
}
