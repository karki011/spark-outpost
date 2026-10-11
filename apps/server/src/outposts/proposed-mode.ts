import { providerModeIds, type AgentModeOption } from '@spark-outpost/contracts';

export interface ModeChoice {
  id: string;
  label: string;
}

export function modeChoices(
  provider: string | null,
  advertised: readonly AgentModeOption[],
): ModeChoice[] {
  const choices = advertised.map(({ id, label }) => ({ id, label }));
  const listed = new Set(choices.map((choice) => choice.id));
  const known = providerModeIds(provider).filter((id) => !listed.has(id));
  return [...choices, ...known.map((id) => ({ id, label: id }))];
}

export function proposedModeId(choices: readonly ModeChoice[], value: string): string | null {
  const wanted = value.trim().toLowerCase();
  const found =
    choices.find((choice) => choice.id === value) ??
    choices.find((choice) => choice.id.toLowerCase() === wanted) ??
    choices.find((choice) => choice.label.toLowerCase() === wanted);
  return found?.id ?? null;
}

function choiceName(choice: ModeChoice): string {
  return choice.label === choice.id ? choice.id : `${choice.label} (${choice.id})`;
}

export function unknownProposedMode(
  handle: string,
  value: string,
  choices: readonly ModeChoice[],
): string {
  const modes = choices.map(choiceName).join(', ');
  return `@${handle}: "${value}" is not a mode of this agent. Modes: ${modes}. Use one of these, or leave the mode out.`;
}
