import { isBusy, isDispatcher, type CrewAgent } from './crew-model.ts';

export interface TvCaption {
  lead: string | null;
  text: string;
}

export function tvCaption(agents: readonly CrewAgent[]): TvCaption {
  const busy = agents.filter((agent) => !isDispatcher(agent) && isBusy(agent.state));
  if (busy.length === 1) return { lead: `Jev → ${busy[0]!.name}`, text: busy[0]!.line };
  if (busy.length > 1) {
    return { lead: `Jev → ${busy.map((agent) => agent.name).join(', ')}`, text: 'working at once' };
  }
  const jev = agents.find(isDispatcher);
  return { lead: jev ? 'Jev' : null, text: jev?.line ?? 'No agents yet' };
}
