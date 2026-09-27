import type { Orchestration } from '@spark-outpost/contracts';

export function whyLines(orchestration: Orchestration): string[] {
  const names = new Map(orchestration.crew.map((member) => [member.runId, member.name]));
  const lines: string[] = [];
  for (const decision of orchestration.decisions) {
    const why = decision.answer.why;
    if (decision.kind !== 'route' || typeof why !== 'string') continue;
    const name = decision.childRunId ? names.get(decision.childRunId) : undefined;
    const line = name ? `${name} · ${why}` : why;
    if (!lines.includes(line)) lines.push(line);
  }
  return lines;
}
