import type { ModelCard } from '@spark-outpost/contracts';
import type { RedirectSettings } from '../../agent-config/redirects.ts';
import { cardFor, VENDOR_CARDS } from '../../model-cards/cards.ts';
import { kilo } from '../../orchestration/escalation.ts';
import type { AgentDefinition } from './agents.ts';

export const LONG_CONTEXT_TOKENS = 1_000_000;

const CLAUDE_ALIASES = ['opus', 'sonnet', 'fable'] as const;
const FIRST_PARTY_HOST = 'api.anthropic.com';
const ROUTING_ENV = [/^CLAUDE_CODE_USE_/, /^ANTHROPIC_(\w+_)?BASE_URL$/, /^ANTHROPIC_UNIX_SOCKET$/];

const aliasVariable = (alias: string) => `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`;

function firstParty(url: string): boolean {
  try {
    return new URL(url).host === FIRST_PARTY_HOST;
  } catch {
    return false;
  }
}

function routesElsewhere(env: Readonly<Record<string, string>>): boolean {
  return Object.entries(env).some(([name, value]) =>
    name === 'ANTHROPIC_BASE_URL'
      ? !firstParty(value)
      : ROUTING_ENV.some((pattern) => pattern.test(name)),
  );
}

function longContextCards(cards: readonly ModelCard[]): ModelCard[] {
  return cards.filter(
    (card) => card.provider === 'claude' && card.contextTokens >= LONG_CONTEXT_TOKENS,
  );
}

export function longContextEnv(
  definition: Pick<AgentDefinition, 'longContext'>,
  env: Readonly<Record<string, string>>,
  redirects: RedirectSettings | null = null,
  cards: readonly ModelCard[] = VENDOR_CARDS.cards,
): Record<string, string> {
  if (!definition.longContext) return {};
  if (routesElsewhere(env) || routesElsewhere(redirects?.env ?? {})) return {};
  const pinned = { ...env, ...redirects?.env };
  const entries = longContextCards(cards).flatMap((card) =>
    CLAUDE_ALIASES.filter((alias) => card.match.ids.includes(alias))
      .map((alias) => aliasVariable(alias))
      .filter((name) => pinned[name] === undefined)
      .map((name) => [name, `${card.id}[1m]`] as const),
  );
  return Object.fromEntries(entries);
}

export function reportedModel(meta: unknown): string | null {
  if (meta === null || typeof meta !== 'object') return null;
  const model = (meta as Record<string, unknown>)['_claude/model'];
  return typeof model === 'string' ? model : null;
}

export function shortWindowNote(meta: unknown, size: number): string | null {
  const model = reportedModel(meta);
  const card = model ? cardFor({ id: model }, 'claude') : null;
  if (!card) return null;
  const window = card.contextTokens;
  if (window < LONG_CONTEXT_TOKENS || size <= 0 || size >= window) return null;
  return `${card.label} is using a ${kilo(size)} context window on this account, not ${kilo(window)}`;
}
