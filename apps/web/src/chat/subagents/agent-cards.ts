import { subagentUsageParts, type SubagentRow } from '@spark-outpost/contracts';
import { subagentDurationMs } from './subagent-view.ts';

export interface AgentCounts {
  total: number;
  working: number;
  done: number;
  failed: number;
  cancelled: number;
}

export function agentCounts(rows: readonly Pick<SubagentRow, 'state'>[]): AgentCounts {
  const count = (state: SubagentRow['state']) => rows.filter((row) => row.state === state).length;
  return {
    total: rows.length,
    working: count('working'),
    done: count('done'),
    failed: count('failed'),
    cancelled: count('cancelled'),
  };
}

function agents(count: number): string {
  return count === 1 ? '1 agent' : `${count} agents`;
}

export function agentsLine(counts: AgentCounts): string {
  const ended = [
    counts.done > 0 ? `${counts.done} done` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
    counts.cancelled > 0 ? `${counts.cancelled} stopped` : null,
  ].filter((part): part is string => part !== null);
  if (counts.working === 0) return [agents(counts.total), ...ended].join(' · ');
  return [`Waiting on ${agents(counts.working)}`, ...ended, 'writing up when all finish'].join(
    ' · ',
  );
}

const PURPOSE_MIN_CHARS = 24;

export function agentPurpose(task: string, name: string): string | null {
  const text = task.trim();
  if (text === '' || text === name) return null;
  const line = text.split('\n')[0]!.trim();
  const sentences = line.match(/.*?[.!?](?=\s|$)|.+$/g) ?? [line];
  let purpose = '';
  for (const sentence of sentences) {
    purpose = `${purpose} ${sentence.trim()}`.trim();
    if (purpose.length >= PURPOSE_MIN_CHARS) break;
  }
  return purpose;
}

export function agentNow(row: SubagentRow): string | null {
  if (row.state !== 'working') return null;
  return row.step ?? row.steps.at(-1)?.name ?? null;
}

export function agentLatestCommand(row: SubagentRow): string | null {
  return row.state === 'working' ? (row.commands.at(-1) ?? null) : null;
}

function compactTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.round(tokens)} tok`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K tok`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tok`;
}

function shortSeconds(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)}m ${rest}s` : `${Math.floor(total / 60)}m`;
}

export function agentMeta(row: SubagentRow): string {
  if (row.state === 'working') {
    return subagentUsageParts({ steps: row.steps }, null).join(' · ');
  }
  const ms = row.usage?.durationMs ?? subagentDurationMs(row);
  const parts = [
    ms !== null && ms !== undefined ? shortSeconds(ms) : null,
    row.usage?.tokens !== undefined ? compactTokens(row.usage.tokens) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' · ') : subagentUsageParts(row, null).join(' · ');
}
