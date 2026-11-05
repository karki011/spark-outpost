import { z } from 'zod';

export const agentRoleSchema = z.enum([
  'scout',
  'architect',
  'builder',
  'critic',
  'coordinator',
  'integrator',
  'spark',
]);
export type AgentRole = z.infer<typeof agentRoleSchema>;

const ROLE_LABELS: Record<AgentRole, string> = {
  scout: 'Reader',
  architect: 'Architect',
  builder: 'Builder',
  critic: 'Critic',
  coordinator: 'Coordinator',
  integrator: 'Integrator',
  spark: 'Spark',
};

export const CREW_NAMES: Record<AgentRole, readonly string[]> = {
  scout: ['Pip', 'Wren', 'Skye'],
  architect: ['Sketch', 'Ada', 'Blue'],
  builder: ['Bolt', 'Rivet', 'Tack', 'Chip', 'Nut'],
  critic: ['Hawk', 'Owl', 'Lynx'],
  coordinator: ['Atlas', 'Juno', 'Vega'],
  integrator: ['Weld', 'Knot', 'Seam'],
  spark: ['Spark'],
};

const ROLE_DUTIES: Record<AgentRole, string> = {
  scout: 'reads and answers',
  architect: 'plans the change',
  builder: 'makes the change',
  critic: 'reviews the change',
  coordinator: 'splits the work into pieces',
  integrator: 'joins the pieces',
  spark: 'does the job you handed it',
};

export function agentRoleLabel(role: AgentRole): string {
  return ROLE_LABELS[role];
}

export function agentName(role: AgentRole, ordinal = 1): string {
  return ordinal > 1 ? `${ROLE_LABELS[role]} ${ordinal}` : ROLE_LABELS[role];
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

export function crewRole(name: string): AgentRole | null {
  const base = name.replace(/ \d+$/, '');
  return agentRoleSchema.options.find((role) => CREW_NAMES[role].includes(base)) ?? null;
}

export function crewTitle(name: string, role: AgentRole | null = crewRole(name)): string {
  if (!role) return name;
  return `${name} · ${ROLE_LABELS[role]} — ${ROLE_DUTIES[role]}`;
}
