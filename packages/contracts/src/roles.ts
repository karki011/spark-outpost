import { z } from 'zod';

export const agentRoleSchema = z.enum([
  'scout',
  'architect',
  'builder',
  'critic',
  'coordinator',
  'integrator',
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

const ROLE_LABELS: Record<AgentRole, string> = {
  scout: 'Scout',
  architect: 'Architect',
  builder: 'Builder',
  critic: 'Critic',
  coordinator: 'Coordinator',
  integrator: 'Integrator',
};

export const CREW_NAMES: Record<AgentRole, readonly string[]> = {
  scout: ['Pip', 'Wren', 'Skye'],
  architect: ['Sketch', 'Ada', 'Blue'],
  builder: ['Bolt', 'Rivet', 'Tack', 'Chip', 'Nut'],
  critic: ['Hawk', 'Owl', 'Lynx'],
  coordinator: ['Atlas', 'Juno', 'Vega'],
  integrator: ['Weld', 'Knot', 'Seam'],
};

export const JEV_NAME = 'Jev';

export function agentRoleLabel(role: AgentRole): string {
  return ROLE_LABELS[role];
}

export function agentName(role: AgentRole, ordinal = 1): string {
  return ordinal > 1 ? `${ROLE_LABELS[role]} ${ordinal}` : ROLE_LABELS[role];
}

export function crewName(role: AgentRole, index: number): string {
  const pool = CREW_NAMES[role];
  const name = pool[index % pool.length]!;
  const round = Math.floor(index / pool.length);
  return round > 0 ? `${name} ${round + 1}` : name;
}

export function nextCrewName(role: AgentRole, used: Iterable<string>): string {
  const taken = new Set(used);
  for (let index = 0; ; index += 1) {
    const name = crewName(role, index);
    if (!taken.has(name)) return name;
  }
}

export function agentLabel(
  role: AgentRole,
  modelLabel: string | null,
  effort: string | null,
  name: string | null = null,
): string {
  const who = name && name !== ROLE_LABELS[role] ? [name, ROLE_LABELS[role]] : [ROLE_LABELS[role]];
  return [...who, modelLabel, effort].filter((part): part is string => Boolean(part)).join(' · ');
}
