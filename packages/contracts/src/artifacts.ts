import { z } from 'zod';

export const PLAN_VERSION_CAP = 200;

export const artifactKindSchema = z.enum([
  'plan',
  'changes',
  'check',
  'review',
  'advice',
  'shortcuts',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const planPrioritySchema = z.enum(['high', 'medium', 'low']);
export type PlanPriority = z.infer<typeof planPrioritySchema>;

export const planStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const planEntrySchema = z.object({
  content: z.string().min(1).max(2000),
  priority: planPrioritySchema,
  status: planStatusSchema,
});
export type PlanEntry = z.infer<typeof planEntrySchema>;

export const todoListSchema = z.array(planEntrySchema).max(200);

export const planBodySchema = z.object({ entries: todoListSchema });

export const TODO_ACTIVITY = 'todo';
export const todoActivitySchema = z.object({ entries: todoListSchema });
export type PlanBody = z.infer<typeof planBodySchema>;

export const planVersionSchema = z.object({
  version: z.number().int().positive(),
  body: planBodySchema,
  sourceRunId: z.uuid().nullable(),
  supersededBy: z.number().int().positive().nullable(),
  createdAt: z.string(),
  usedBy: z.array(z.uuid()),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;

export interface PlanStatusChange {
  content: string;
  from: PlanStatus;
  to: PlanStatus;
}

export interface PlanChanges {
  added: string[];
  removed: string[];
  statusChanged: PlanStatusChange[];
  replaced: boolean;
}

function byContent(entries: readonly PlanEntry[]): Map<string, PlanEntry> {
  const map = new Map<string, PlanEntry>();
  for (const entry of entries) if (!map.has(entry.content)) map.set(entry.content, entry);
  return map;
}

export function planChanges(
  previous: readonly PlanEntry[],
  next: readonly PlanEntry[],
): PlanChanges {
  const before = byContent(previous);
  const after = byContent(next);
  const added = [...after.keys()].filter((content) => !before.has(content));
  const removed = [...before.keys()].filter((content) => !after.has(content));
  const statusChanged: PlanStatusChange[] = [];
  for (const [content, entry] of after) {
    const earlier = before.get(content);
    if (earlier && earlier.status !== entry.status) {
      statusChanged.push({ content, from: earlier.status, to: entry.status });
    }
  }
  const union = after.size + removed.length;
  const replaced = before.size > 0 && (added.length + removed.length) * 2 > union;
  return { added, removed, statusChanged, replaced };
}

export function samePlan(a: readonly PlanEntry[], b: readonly PlanEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.content === b[index]!.content &&
        entry.priority === b[index]!.priority &&
        entry.status === b[index]!.status,
    )
  );
}

export interface ArtifactVersionRecord {
  version: number;
  body: unknown;
  createdAt: string;
  supersededBy?: number | null;
}

function checklistLine(entry: PlanEntry): string {
  const box = entry.status === 'completed' ? 'x' : ' ';
  const progress =
    entry.status === 'in_progress'
      ? ' (in progress)'
      : entry.status === 'failed'
        ? ' (failed)'
        : '';
  const priority = entry.priority === 'medium' ? '' : ` · ${entry.priority} priority`;
  return `- [${box}] ${entry.content}${progress}${priority}`;
}

function stamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

function changeSummary(changes: PlanChanges): string {
  const count = (status: PlanStatus) =>
    changes.statusChanged.filter((change) => change.to === status).length;
  const done = count('completed');
  const failed = count('failed');
  const started = changes.statusChanged.length - done - failed;
  const parts = [
    changes.added.length > 0 ? `${changes.added.length} added` : '',
    changes.removed.length > 0 ? `${changes.removed.length} removed` : '',
    done > 0 ? `${done} done` : '',
    failed > 0 ? `${failed} failed` : '',
    started > 0 ? `${started} started` : '',
  ].filter(Boolean);
  return parts.join(', ') || 'no changes';
}

function planMarkdown(versions: readonly ArtifactVersionRecord[]): string {
  const plans = versions.map((version) => ({
    ...version,
    entries: planBodySchema.parse(version.body).entries,
  }));
  const latest = plans.at(-1);
  if (!latest) return '# Plan\n\nNo plan yet.\n';
  const lines = [`# Plan v${latest.version}`, '', ...latest.entries.map(checklistLine), ''];
  if (plans.length > 1) {
    lines.push('## History', '');
    plans.forEach((plan, index) => {
      const previous = plans[index - 1];
      const summary = previous
        ? changeSummary(planChanges(previous.entries, plan.entries))
        : `first plan, ${plan.entries.length} entries`;
      const superseded = plan.supersededBy ? ` · replaced by v${plan.supersededBy}` : '';
      lines.push(`- v${plan.version} · ${stamp(plan.createdAt)} · ${summary}${superseded}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

export function artifactMarkdown(
  kind: ArtifactKind,
  versions: readonly ArtifactVersionRecord[],
): string {
  if (kind === 'plan') return planMarkdown(versions);
  const latest = versions.at(-1);
  const title = `# ${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  if (!latest) return `${title}\n\nNothing recorded yet.\n`;
  return `${title} v${latest.version}\n\n\`\`\`json\n${JSON.stringify(latest.body, null, 2)}\n\`\`\`\n`;
}
