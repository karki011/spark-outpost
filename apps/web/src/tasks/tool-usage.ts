import {
  isSparkServer,
  parseMcpTool,
  toolLabel,
  type ActivityStep,
} from '@spark-outpost/contracts';

export interface UsageRow {
  key: string;
  label: string;
  calls: number;
  ms: number;
}

export interface ToolUsage {
  tools: UsageRow[];
  servers: UsageRow[];
  skills: UsageRow[];
}

const SKILL_TOOL = 'Skill';
const SKILL_NAME = /"(?:skill|command|name)"\s*:\s*"([^"]+)"/;

function durationOf(step: ActivityStep): number {
  if (step.startedAt === undefined || step.finishedAt === undefined) return 0;
  return Math.max(0, step.finishedAt - step.startedAt);
}

function add(rows: Map<string, UsageRow>, key: string, label: string, ms: number): void {
  const row = rows.get(key) ?? { key, label, calls: 0, ms: 0 };
  row.calls += 1;
  row.ms += ms;
  rows.set(key, row);
}

function serverLabel(server: string): string {
  return isSparkServer(server) ? 'Spark' : server;
}

export function skillOf(step: ActivityStep): string | null {
  if (step.toolName !== SKILL_TOOL) return null;
  return SKILL_NAME.exec(step.target ?? '')?.[1]?.trim() || null;
}

function ranked(rows: Map<string, UsageRow>): UsageRow[] {
  return [...rows.values()].sort(
    (a, b) => b.calls - a.calls || b.ms - a.ms || a.label.localeCompare(b.label),
  );
}

export function toolUsage(steps: readonly ActivityStep[]): ToolUsage {
  const tools = new Map<string, UsageRow>();
  const servers = new Map<string, UsageRow>();
  const skills = new Map<string, UsageRow>();
  for (const step of steps) {
    const name = step.toolName?.trim();
    if (!name) continue;
    const ms = durationOf(step);
    add(tools, name, toolLabel(name) ?? name, ms);
    const mcp = parseMcpTool(name);
    if (mcp) add(servers, mcp.server, serverLabel(mcp.server), ms);
    const skill = skillOf(step);
    if (skill) add(skills, skill, skill, ms);
  }
  return { tools: ranked(tools), servers: ranked(servers), skills: ranked(skills) };
}

export function stepsOfRuns(
  activity: Readonly<Record<string, readonly ActivityStep[]>> | undefined,
  runIds: readonly string[],
): ActivityStep[] {
  return runIds.flatMap((id) => activity?.[id] ?? []);
}
