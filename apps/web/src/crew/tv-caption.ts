import { isBusy, isDispatcher, type CrewAgent } from './crew-model.ts';

export interface TvCaption {
  lead: string | null;
  text: string;
}

export function tvCaption(agents: readonly CrewAgent[]): TvCaption {
  const jev = agents.find(isDispatcher);
  const hub = jev?.name ?? 'Jev';
  const busy = agents.filter((agent) => !isDispatcher(agent) && isBusy(agent.state));
  if (busy.length === 1) return { lead: `${hub} → ${busy[0]!.name}`, text: busy[0]!.line };
  if (busy.length > 1) {
    return {
      lead: `${hub} → ${busy.map((agent) => agent.name).join(', ')}`,
      text: 'working at once',
    };
  }
  return { lead: jev ? hub : null, text: jev?.line ?? 'No agents yet' };
}
