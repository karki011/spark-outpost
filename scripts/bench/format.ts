import type { AgentUsage, CellResult } from './results.ts';

export function usd(value: number): string {
  if (value === 0) return '$0';
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(3)}`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function thousands(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value));
}

export function ratio(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(2)}×`;
}

export function agentLabel(agent: AgentUsage): string {
  const model = agent.model ?? agent.provider;
  const effort = agent.effort ? ` ${agent.effort}` : '';
  const group = agent.parallelGroup ? ` [${agent.parallelGroup}]` : '';
  return `${agent.role} ${model}${effort}${group}`;
}

export function crewLine(result: CellResult): string {
  return result.agents.map(agentLabel).join(', ');
}

export interface TokenSplit {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function tokenSplit(result: CellResult): TokenSplit {
  return result.agents.reduce(
    (sum, agent) => ({
      input: sum.input + agent.inputTokens,
      output: sum.output + agent.outputTokens,
      cacheRead: sum.cacheRead + agent.cachedReadTokens,
      cacheWrite: sum.cacheWrite + agent.cachedWriteTokens,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
}

export function tokenCells(result: CellResult): string {
  const split = tokenSplit(result);
  return [split.input, split.output, split.cacheRead, split.cacheWrite].map(thousands).join(' / ');
}

export function verdict(result: CellResult): string {
  if (result.verification.passed) return 'pass';
  return `fail (${result.verification.reasons.join(' ')})`;
}
