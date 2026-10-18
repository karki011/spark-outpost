import {
  cacheHitCounts,
  cacheHitRate,
  turnCostOrigin,
  usageOriginLabel,
  type NativeTerminalProvider,
  type NativeTerminalTurn,
} from '@spark-outpost/contracts';
import { formatTokens } from '../../chat/composer/model-options.ts';
import { formatCost } from '../../usage/format.ts';

export interface TurnUsageText {
  tokens: string;
  detail: string | null;
  cost: string;
  origin: string;
}

function tokenDetail(tokens: NonNullable<NativeTerminalTurn['tokens']>): string {
  const parts = [`in ${formatTokens(tokens.input)}`, `out ${formatTokens(tokens.output)}`];
  if (tokens.cachedRead) parts.push(`cache read ${formatTokens(tokens.cachedRead)}`);
  if (tokens.cachedWrite) parts.push(`cache write ${formatTokens(tokens.cachedWrite)}`);
  if (tokens.thought) parts.push(`thinking ${formatTokens(tokens.thought)}`);
  return parts.join(' · ');
}

export function turnUsageText(
  turn: NativeTerminalTurn,
  provider: NativeTerminalProvider | null,
): TurnUsageText {
  const origin = turnCostOrigin(turn);
  const unknown = usageOriginLabel('unknown');
  return {
    tokens: turn.tokens ? `${formatTokens(turn.tokens.total)} tokens` : `Tokens ${unknown}`,
    detail: turn.tokens ? tokenDetail(turn.tokens) : null,
    cost:
      turn.costUsd === null
        ? `Cost ${unknown}`
        : formatCost(turn.costUsd, origin === 'reported' ? 'reported' : 'estimated'),
    origin: turn.costUsd === null ? '' : usageOriginLabel(origin, provider),
  };
}

export function estimateTotal(turns: readonly NativeTerminalTurn[]): number | null {
  const priced = turns.flatMap((turn) => (turn.costUsd === null ? [] : [turn.costUsd]));
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((sum, cost) => sum + cost, 0) * 1_000_000) / 1_000_000;
}

export function turnsCacheHit(
  turns: readonly NativeTerminalTurn[],
  provider: NativeTerminalProvider | null,
): number | null {
  if (!provider) return null;
  return cacheHitRate(
    turns.flatMap((turn) => (turn.tokens ? [cacheHitCounts(provider, turn.tokens)] : [])),
  );
}
