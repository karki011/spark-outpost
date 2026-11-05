import type { Queryable } from '../src/persistence/db.ts';
import {
  seedAnalyticsTurn,
  seedProjectChat,
  type AnalyticsTurn,
  type SeedIntake,
  type SeedMember,
} from './analytics-seed.ts';

type Random = () => number;

function mulberry32(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, weighted: readonly (readonly [T, number])[]): T {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return weighted.at(-1)![0];
}

const MODELS = {
  claude: [
    ['claude-haiku-4-5', 'Haiku 4.5', 1, 5, 0],
    ['claude-sonnet-5', 'Sonnet 5', 2, 10, 1],
    ['claude-opus-5-5', 'Opus 5.5', 4, 20, 2],
  ],
  codex: [
    ['gpt-6-luna', '6 Luna', 0.1, 0.5, 0],
    ['gpt-6-sol', '6 Sol', 2, 10, 1],
    ['gpt-5.6-sol', 'GPT-5.6 Sol', 4, 20, 2],
  ],
  zai: [
    ['glm-5.3-flash', 'GLM-5.3-Flash', 0.15, 0.5, 0],
    ['glm-5.3', 'GLM-5.3', 1.4, 4.4, 2],
  ],
} as const;

type Provider = keyof typeof MODELS;

const CATEGORIES = [
  ['bug_fix', 25],
  ['feature', 20],
  ['question', 15],
  ['refactor', 12],
  ['debugging', 10],
  ['review', 8],
  ['docs', 5],
  ['setup', 5],
] as const;

function depthFor(random: Random, category: string): string {
  if (category === 'question' || category === 'docs') return random() < 0.8 ? 'direct' : 'execute';
  if (category === 'review') return 'execute';
  if (category === 'refactor') return random() < 0.6 ? 'plan_execute_review' : 'plan_execute';
  if (category === 'feature') return random() < 0.55 ? 'plan_execute' : 'plan_execute_review';
  return random() < 0.6 ? 'execute' : 'plan_execute';
}

function member(
  random: Random,
  role: SeedMember['role'],
  provider: Provider,
  tier: number,
  name: string,
): SeedMember & { tier: number } {
  const options = MODELS[provider];
  const model = options.find((option) => option[4] === tier) ?? options[options.length - 1]!;
  const input = Math.round(8_000 + random() * 40_000);
  const output = Math.round(800 + random() * 6_000);
  const cachedRead = Math.round(input * (0.3 + random() * 0.6));
  const cost =
    ((input - cachedRead) * model[2] + cachedRead * model[2] * 0.1 + output * model[3]) / 1e6;
  const continued = random() < 0.55;
  return {
    role,
    provider,
    model: model[0],
    modelLabel: model[1],
    name,
    costUsd: Math.round(cost * 1e6) / 1e6,
    costSource: provider === 'claude' ? 'reported' : 'estimated',
    input,
    output,
    cachedRead,
    routedByJev: random() < 0.6,
    session: continued ? 'continued' : 'fresh',
    tier: model[4],
  };
}

function crewFor(random: Random, depth: string, provider: Provider, tier: number): SeedMember[] {
  if (depth === 'direct') return [];
  const crew: SeedMember[] = [];
  if (depth !== 'execute')
    crew.push(member(random, 'architect', provider, Math.max(1, tier), 'Ada'));
  const builders = depth === 'execute' ? 1 : random() < 0.25 ? 2 : 1;
  for (let index = 0; index < builders; index++) {
    crew.push(member(random, 'builder', provider, tier, ['Bolt', 'Rivet'][index]!));
  }
  if (depth === 'plan_execute_review') {
    const other: Provider = provider === 'claude' ? 'codex' : 'claude';
    crew.push(member(random, 'critic', other, 1, 'Hawk'));
  }
  return crew;
}

function intakeFor(random: Random, depth: string, tier: number, provider: Provider): SeedIntake {
  const rules = {
    provider,
    depth,
    model: MODELS[provider][0][0],
    modelLabel: MODELS[provider][0][1],
    effort: 'medium',
    risk: 'edits',
  };
  if (random() < 0.15) return { rules, jev: null, wouldApply: 'rules' };
  const confidence = Math.min(0.99, 0.45 + Math.sqrt(random()) * 0.55);
  const actAt =
    depth === 'direct'
      ? 0.75
      : pick(random, [
          [0.9, 6],
          [0.8, 3],
          [0.95, 1],
        ] as const);
  const decision =
    confidence >= actAt
      ? 'act'
      : confidence < 0.5
        ? 'fallback'
        : random() < 0.4
          ? 'ask'
          : 'fallback';
  const jev: Record<string, unknown> = { ...rules, confidence };
  const differs = random() < 0.45;
  if (differs) {
    const field = pick(random, [
      ['model', 6],
      ['depth', 3],
      ['effort', 1],
    ] as const);
    if (field === 'model') {
      const upgrade =
        MODELS[provider].find((entry) => entry[4] === Math.max(1, tier)) ?? MODELS[provider][1]!;
      jev.model = upgrade[0];
      jev.modelLabel = upgrade[1];
    }
    if (field === 'depth') jev.depth = depth === 'execute' ? 'plan_execute' : 'execute';
    if (field === 'effort') jev.effort = 'high';
  }
  const wouldApply = decision === 'act' ? 'jev' : decision === 'ask' ? 'ask' : 'rules';
  return { rules, jev, wouldApply, decision, actAt, jevCostUsd: 0.0004 + random() * 0.0008 };
}

function outcomeFor(random: Random, turn: AnalyticsTurn, quality: number): void {
  if (random() < 0.07) {
    turn.verdict = 'unclear';
    return;
  }
  const score = Math.max(-1, Math.min(1, quality + (random() - 0.5) * 1.9));
  turn.score = Math.round(score * 100) / 100;
  turn.verdict = score > 0.3 ? 'good' : score < -0.3 ? 'bad' : 'mixed';
  if (turn.verdict === 'good') turn.signals = random() < 0.5 ? ['kept', 'committed'] : ['kept'];
  if (turn.verdict === 'bad')
    turn.signals = random() < 0.6 ? ['reverted', 'correction'] : ['correction'];
  if (turn.verdict === 'mixed')
    turn.signals =
      random() < 0.55 ? ['kept'] : random() < 0.55 ? ['kept', 'correction'] : ['reverted'];
}

export interface RealisticOptions {
  days?: number;
  seed?: number;
  now?: Date;
}

export async function seedRealisticAnalytics(
  db: Queryable,
  workspaceId: string,
  { days = 90, seed = 7, now = new Date() }: RealisticOptions = {},
): Promise<number> {
  const random = mulberry32(seed);
  const chats = {
    'spark-outpost': await seedProjectChat(db, workspaceId, 'spark-outpost'),
    'lumen-docs': await seedProjectChat(db, workspaceId, 'lumen-docs'),
    'pantry-api': await seedProjectChat(db, workspaceId, 'pantry-api'),
    none: await seedProjectChat(db, workspaceId, null),
  };
  let seeded = 0;
  for (let back = days - 1; back >= 0; back--) {
    const day = new Date(now.getTime() - back * 86_400_000);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const ramp = 1 + (days - back) / days;
    const expected = (weekend ? 1.2 : 4.2) * ramp;
    const turns = random() < 0.08 ? 0 : Math.round(expected * (0.4 + random() * 1.2));
    for (let index = 0; index < turns; index++) {
      const project = pick(random, [
        ['spark-outpost', 50],
        ['pantry-api', 22],
        ['lumen-docs', 16],
        ['none', 12],
      ] as const);
      const category = pick(random, CATEGORIES);
      const depth = depthFor(random, category);
      const provider = pick(random, [
        ['claude', 55],
        ['codex', 30],
        ['zai', 15],
      ] as const);
      const tier = pick(random, [
        [0, 3],
        [1, 5],
        [2, 2],
      ] as const);
      const crew = crewFor(random, depth, provider, tier);
      const createdAt = new Date(day.getTime() - (index + 1) * 1_700_000 - random() * 600_000);
      if (createdAt > now) continue;
      const intake = intakeFor(random, depth, tier, provider);
      const building = crew.some((entry) => entry.role === 'builder');
      const lean =
        project === 'spark-outpost' && back < 45
          ? 'lean'
          : project === 'lumen-docs'
            ? 'lite'
            : 'off';
      const turn: AnalyticsTurn = {
        conversationId: chats[project],
        createdAt,
        provider,
        model: MODELS[provider][tier === 0 ? 0 : 1]?.[0],
        category,
        depth,
        crew,
        intake,
        retries: building && random() < 0.12 ? 1 : 0,
        costUsd: crew.length === 0 ? Math.round((0.004 + random() * 0.03) * 1e6) / 1e6 : undefined,
        buildStyle: building ? lean : undefined,
      };
      if (building && project !== 'none' && random() < 0.75) {
        const first = random() < 0.74 ? 'passed' : 'failed';
        turn.checks =
          first === 'passed'
            ? [{ round: 1, status: 'passed' }]
            : [
                { round: 1, status: 'failed' },
                { round: 2, status: random() < 0.7 ? 'passed' : 'failed' },
              ];
      }
      if (crew.some((entry) => entry.role === 'critic')) {
        const concerns = random() < 0.3;
        turn.reviews = [
          {
            verdict: concerns ? 'concerns' : random() < 0.9 ? 'looks_good' : 'unclear',
            findings: concerns ? 1 + Math.floor(random() * 4) : Math.floor(random() * 2),
            ...(lean !== 'off' ? { net: -Math.floor(random() * 40) } : {}),
          },
        ];
      }
      if (building && random() < 0.45) {
        const wait = Math.exp(Math.log(40_000) + (random() - 0.5) * 2.4);
        turn.approvals = [
          {
            kind: pick(random, [
              ['execute', 5],
              ['edit', 3],
              ['plan', 2],
            ] as const),
            waitMs: Math.round(wait),
          },
        ];
      }
      const applied = intake.wouldApply === 'jev' ? 0.12 : 0;
      const quality =
        0.12 +
        tier * 0.12 +
        (lean === 'lean' ? 0.05 : 0) +
        applied -
        (turn.checks?.[0]?.status === 'failed' ? 0.3 : 0);
      outcomeFor(random, turn, quality);
      await seedAnalyticsTurn(db, turn);
      seeded += 1;
    }
  }
  return seeded;
}
