import {
  autonomyLabel,
  isTerminalRunStatus,
  type ConversationDetail,
  type ConversationUsage,
  type InvolvementLevel,
  type Orchestration,
  type PrChecks,
  type PrWatch,
} from '@spark-outpost/contracts';
import { castAgents, isSparkLed, tvCast } from '../../crew/conversation-crew.ts';
import type { LeadSteps } from '../../crew/lead-steps.ts';
import { isBusy, modelLabel, roleLabel, type CrewAgent } from '../../crew/crew-model.ts';
import { crewAgents } from '../../crew/crew-projection.ts';
import { turnState } from '../../crew/tv-list.ts';
import { teamAgents } from '../../crew/worker-identity.ts';
import { countLabel } from '../../ui/count-label.ts';
import { formatTokens } from '../composer/model-options.ts';
import { filesLabel, formatTotal } from '../changes/change-rules.ts';
import { followingLine } from '../project/agent-setup.ts';
import { repoSummary } from '../project/repo-list.ts';
import type { WorkTab } from '../../tasks/TaskDetails.tsx';
import { formatCost } from '../../usage/format.ts';

export type RailRowId = 'project' | 'agent' | 'following' | 'autonomy' | 'changes' | 'pr' | 'usage';

export type RailAction =
  | { kind: 'project' }
  | { kind: 'tab'; tab: WorkTab }
  | { kind: 'autonomy' }
  | { kind: 'changes' }
  | { kind: 'link'; href: string };

export type RailTone = 'ok' | 'warn' | 'bad';

export interface RailRow {
  id: RailRowId;
  text: string;
  detail: string | null;
  label: string;
  action: RailAction | null;
  tone?: RailTone;
  counts?: { added: number; removed: number };
}

export interface RailFacts {
  repoNames: readonly string[];
  branch: { name: string; worktree: boolean } | null;
  provider: string;
  model: string | null;
  mode: string;
  autonomy: InvolvementLevel | null;
  changes: { files: number; added: number; removed: number } | null;
  watch: Pick<PrWatch, 'repo' | 'number' | 'url' | 'prState' | 'draft' | 'checks'> | null;
  pulls?: number;
  usage: ConversationUsage;
  contextPercent: number | null;
  hasTask: boolean;
  hasStoredCrew?: boolean;
  following?: readonly string[];
}

const CHECKS: Record<PrChecks, { text: string; tone?: RailTone }> = {
  none: { text: 'No checks' },
  pending: { text: 'Checks running', tone: 'warn' },
  passing: { text: 'Checks passing', tone: 'ok' },
  failing: { text: 'Checks failing', tone: 'bad' },
};

function prState(watch: NonNullable<RailFacts['watch']>): string {
  if (watch.prState !== 'open') return watch.prState === 'merged' ? 'Merged' : 'Closed';
  return watch.draft ? 'Draft' : 'Open';
}

const SHORT_MODES: Readonly<Record<string, string>> = { 'Bypass permissions': 'Bypass' };

function pullRow(watch: NonNullable<RailFacts['watch']>, count: number, hasTask: boolean): RailRow {
  const name = `${watch.repo}#${watch.number}`;
  const checks = CHECKS[watch.checks];
  const tone = checks.tone ? { tone: checks.tone } : {};
  if (count > 1) {
    return {
      id: 'pr',
      text: `${count} pull requests`,
      detail: `#${watch.number} ${prState(watch)}`,
      label: `${count} pull requests. ${name} is ${prState(watch).toLowerCase()}, ${checks.text.toLowerCase()}`,
      action: hasTask ? { kind: 'tab', tab: 'links' } : { kind: 'link', href: watch.url },
      ...tone,
    };
  }
  return {
    id: 'pr',
    text: `PR #${watch.number}`,
    detail: checks.text,
    label: `Pull request ${name}, ${prState(watch)}, ${checks.text.toLowerCase()}. Opens on GitHub`,
    action: { kind: 'link', href: watch.url },
    ...tone,
  };
}

function projectRow(facts: RailFacts): RailRow {
  if (facts.repoNames.length === 0) {
    return {
      id: 'project',
      text: 'Not linked',
      detail: 'Choose project',
      label: 'Not linked. Choose project',
      action: { kind: 'project' },
    };
  }
  const name = repoSummary(facts.repoNames);
  const { branch } = facts;
  const place = branch ? `${branch.name} · ${branch.worktree ? 'worktree' : 'my files'}` : null;
  return {
    id: 'project',
    text: name,
    detail: branch?.name ?? null,
    label: place ? `Project ${name}, ${place}` : `Project ${name}`,
    action: { kind: 'project' },
  };
}

function usageRow(facts: RailFacts): RailRow | null {
  const { usage, contextPercent } = facts;
  const tokens = usage.totalTokens > 0 ? `${formatTokens(usage.totalTokens)} tokens` : null;
  const cost = usage.costUsd === null ? null : formatCost(usage.costUsd, usage.costSource ?? null);
  const context = contextPercent === null ? null : `${contextPercent}% context`;
  const text = cost ?? tokens ?? context;
  if (text === null) return null;
  const detail = text === context ? null : context;
  return {
    id: 'usage',
    text,
    detail,
    label: [[tokens, cost].filter(Boolean).join(' · '), detail].filter(Boolean).join(', ') || text,
    action: facts.hasTask ? { kind: 'tab', tab: 'cost' } : null,
  };
}

function followingRow(files: readonly string[]): RailRow | null {
  const line = followingLine(files);
  if (!line) return null;
  return {
    id: 'following',
    text: `Following ${files.length}`,
    detail: files[0] ?? null,
    label: line,
    action: null,
  };
}

export function railRows(facts: RailFacts): RailRow[] {
  const rows: RailRow[] = [projectRow(facts)];
  const agent = [facts.provider, facts.model].filter(Boolean).join(' · ');
  const mode = facts.repoNames.length > 0 ? `mode ${facts.mode}` : facts.mode;
  rows.push({
    id: 'agent',
    text: facts.model || facts.provider,
    detail: SHORT_MODES[facts.mode] ?? facts.mode,
    label: `Agent ${agent}, ${mode}`,
    action: facts.hasTask && facts.hasStoredCrew ? { kind: 'tab', tab: 'crew' } : null,
  });
  const following = followingRow(facts.following ?? []);
  if (following) rows.push(following);
  if (facts.autonomy) {
    const level = autonomyLabel(facts.autonomy);
    rows.push({
      id: 'autonomy',
      text: level,
      detail: null,
      label: `Spark autonomy: ${level}`,
      action: { kind: 'autonomy' },
    });
  }
  if (facts.changes && facts.changes.files > 0) {
    const { files, added, removed } = facts.changes;
    rows.push({
      id: 'changes',
      text: filesLabel(files),
      detail: null,
      label: `${filesLabel(files)} changed, ${formatTotal(added)} added, ${formatTotal(removed)} removed. Review changes`,
      action: { kind: 'changes' },
      counts: { added, removed },
    });
  }
  if (facts.watch) rows.push(pullRow(facts.watch, facts.pulls ?? 1, facts.hasTask));
  const usage = usageRow(facts);
  if (usage) rows.push(usage);
  return rows;
}

export function finishedCrew(
  orchestration: Orchestration,
  agents: readonly CrewAgent[],
): CrewAgent[] {
  if (!isTerminalRunStatus(orchestration.status)) return [...agents];
  const ended = turnState(orchestration.status);
  return agents.map((agent) =>
    isBusy(agent.state) || agent.state === 'queued' ? { ...agent, state: ended } : agent,
  );
}

export function railCrew(detail: ConversationDetail, live: LeadSteps = new Map()): CrewAgent[] {
  const cast = tvCast(detail, live);
  if (!cast) return [];
  const stored = detail.orchestrations?.[cast.run.id];
  if (stored && !isSparkLed(stored))
    return finishedCrew(stored, crewAgents(stored, detail.activity));
  return teamAgents(castAgents(cast), cast.subagents);
}

export function crewHeading(agents: readonly CrewAgent[], mode: string): string {
  const only = agents.length === 1 ? agents[0] : undefined;
  if (only) return [only.name, mode].filter(Boolean).join(' · ');
  return `Crew · ${countLabel(agents.length, 'agent')}`;
}

export function crewSectionLabel(agents: readonly CrewAgent[]): string {
  return agents.length === 1 ? 'Agent' : 'Crew';
}

export function crewJob(agent: CrewAgent): string {
  const turns = agent.turns && agent.turns > 1 ? `${agent.turns} turns` : null;
  return [roleLabel(agent), modelLabel(agent), turns].filter(Boolean).join(' · ');
}

export function latestFollowing(detail: Pick<ConversationDetail, 'runs'>): readonly string[] {
  return detail.runs.findLast((run) => !run.parentRunId && run.following?.length)?.following ?? [];
}
