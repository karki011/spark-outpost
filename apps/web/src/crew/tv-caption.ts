import { isBusy, type CrewAgent } from './crew-model.ts';

export interface TvCaption {
  lead: string | null;
  text: string;
}

export function tvCaption(agents: readonly CrewAgent[]): TvCaption {
  const busy = agents.filter((agent) => isBusy(agent.state));
  if (busy.length === 1) return { lead: busy[0]!.name, text: busy[0]!.line };
  if (busy.length > 1) {
    return { lead: busy.map((agent) => agent.name).join(', '), text: 'working at once' };
  }
  const first = agents[0];
  return { lead: first?.name ?? null, text: first?.line ?? 'No agents yet' };
}
