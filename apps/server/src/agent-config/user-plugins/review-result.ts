import { z } from 'zod';
import type { PluginFinding, PluginScanStatus, UserPlugin } from '@spark-outpost/contracts';
import { scanStatus } from './checks.ts';
import type { ScannedPlugin } from './scan.ts';

export type AgentReviewState = UserPlugin['scan']['agentReview'];
export type AgentReviewCost = NonNullable<UserPlugin['scan']['agentReviewCost']>;

const MAX_FINDINGS = 50;

const FINDING_TITLE_MAX = 60;

const agentFindingSchema = z.object({
  severity: z.enum(['review', 'flagged']),
  rule: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(FINDING_TITLE_MAX).optional().catch(undefined),
  file: z.string().trim().max(500),
  line: z.number().int().positive().nullable().default(null),
  reason: z.string().trim().min(1).max(1_000),
});

const replySchema = z.object({ findings: z.array(agentFindingSchema).max(MAX_FINDINGS) });

function jsonCandidates(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((match) => match[1]!);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  const bare = start !== -1 && end > start ? [text.slice(start, end + 1)] : [];
  return [...fenced, ...bare];
}

function parsedFindings(candidate: string): PluginFinding[] | null {
  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch {
    return null;
  }
  const parsed = replySchema.safeParse(json);
  if (!parsed.success) return null;
  return parsed.data.findings.map(({ title, ...finding }) => ({
    source: 'agent',
    ...finding,
    ...(title === undefined ? {} : { title }),
  }));
}

export function parseReviewReply(text: string): PluginFinding[] | null {
  const answers = jsonCandidates(text)
    .map(parsedFindings)
    .filter((findings) => findings !== null);
  if (answers.length === 0) return null;
  const unique = new Map(answers.flat().map((finding) => [JSON.stringify(finding), finding]));
  return [...unique.values()];
}

export interface StoredReview {
  findings: PluginFinding[] | null;
  error: string | null;
  runStatus: string | null;
  createdAt: Date;
  tokens: number | null;
  costUsd: number | null;
}

const WORKING_RUN = new Set(['queued', 'running']);

export function reviewState(review: StoredReview | undefined): AgentReviewState {
  if (!review) return 'off';
  if (review.findings !== null) return 'done';
  if (review.error !== null) return 'failed';
  return review.runStatus !== null && WORKING_RUN.has(review.runStatus) ? 'pending' : 'failed';
}

export function needsReview(review: StoredReview | undefined, again: boolean): boolean {
  if (!review) return true;
  return again && reviewState(review) !== 'pending';
}

const RANK: Record<PluginScanStatus, number> = { pending: 0, clean: 1, review: 2, flagged: 3 };

function higher(a: PluginScanStatus, b: PluginScanStatus): PluginScanStatus {
  return RANK[b] > RANK[a] ? b : a;
}

export interface ReviewedPlugin {
  plugin: ScannedPlugin;
  agentReview: AgentReviewState;
  cost: AgentReviewCost | null;
  error: string | null;
}

const ERROR_SHOWN_MAX = 300;

function errorOf(review: StoredReview | undefined, state: AgentReviewState): string | null {
  if (state !== 'failed' || !review?.error) return null;
  return review.error.slice(0, ERROR_SHOWN_MAX);
}

function costOf(review: StoredReview | undefined): AgentReviewCost | null {
  if (!review || review.tokens === null) return null;
  return { tokens: review.tokens, usd: review.costUsd };
}

export function withAgentReview(
  plugin: ScannedPlugin,
  review: StoredReview | undefined,
): ReviewedPlugin {
  const agentReview = reviewState(review);
  const cost = costOf(review);
  const error = errorOf(review, agentReview);
  const agentFindings = agentReview === 'done' ? (review?.findings ?? []) : [];
  if (agentFindings.length === 0) return { plugin, agentReview, cost, error };
  const findings = [...plugin.findings, ...agentFindings];
  const status = higher(plugin.status, scanStatus(agentFindings));
  return { plugin: { ...plugin, findings, status }, agentReview, cost, error };
}
