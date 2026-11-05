import type { TicketMove, TicketMoveOptions, TicketMoveStatuses } from '@spark-outpost/contracts';
import type { PickerChoice } from '../ui/ChoicePicker.tsx';

export const AUTOMATIC = '';

export interface MoveNote {
  project: string;
  text: string;
  warn: boolean;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function moveChoices(
  options: TicketMoveOptions | undefined,
  move: TicketMove,
  chosen: string | undefined,
): PickerChoice[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (!names.some((known) => same(known, name))) names.push(name);
  };
  for (const project of options?.projects ?? []) project.moves[move].choices.forEach(add);
  if (chosen) add(chosen);
  return [
    { id: AUTOMATIC, label: 'Automatic' },
    ...names.map((name) => ({ id: name, label: name })),
  ];
}

export function moveNotes(
  options: TicketMoveOptions | undefined,
  move: TicketMove,
  chosen: string | undefined,
): MoveNote[] {
  return (options?.projects ?? []).map(({ project, moves }) => {
    const { to, problem, choices } = moves[move];
    if (!to) return { project, text: problem ?? 'No status found.', warn: true };
    if (chosen && !choices.some((name) => same(name, chosen))) {
      return {
        project,
        text: `No status named ${chosen} here, so Automatic uses ${to}.`,
        warn: true,
      };
    }
    return { project, text: chosen ? `Moves to ${to}.` : `Automatic uses ${to}.`, warn: false };
  });
}

export function withMove(
  current: TicketMoveStatuses,
  move: TicketMove,
  choice: string,
): TicketMoveStatuses {
  const rest = Object.fromEntries(
    Object.entries(current).filter(([key]) => key !== move),
  ) as TicketMoveStatuses;
  return choice === AUTOMATIC ? rest : { ...rest, [move]: choice };
}
