import {
  ticketMoveSchema,
  type TicketMove,
  type TicketMoveOption,
  type TicketMoveOptions,
} from '@spark-outpost/contracts';
import type { OpenSource } from './connections.ts';
import {
  groupWord,
  resolveGroup,
  settingsFor,
  type GroupTarget,
  type MoveSettings,
} from './move-target.ts';
import type { SourceState } from './status.ts';

function warning(move: TicketMove, target: Extract<GroupTarget<SourceState>, { found: false }>) {
  const names = target.names.join(', ');
  if (target.problem === 'none') return `No ${groupWord(move)} status. Choose one.`;
  if (target.problem === 'never') return `Spark never picks ${names} on its own. Choose one.`;
  return `Several ${groupWord(move)} statuses: ${names}. Choose one.`;
}

function moveOption(
  statuses: readonly SourceState[],
  move: TicketMove,
  settings: MoveSettings,
): TicketMoveOption {
  const kind = move === 'done' ? 'done' : 'started';
  const choices = statuses.filter((state) => state.kind === kind).map((state) => state.name);
  const target = resolveGroup(statuses, move, settings);
  if (target.found) return { choices, to: target.state.name, problem: null };
  return { choices, to: null, problem: warning(move, target) };
}

export async function moveOptions(open: OpenSource): Promise<TicketMoveOptions> {
  const assigned = await open.source.listAssigned({});
  const projects = [...new Set(assigned.flatMap((ticket) => ticket.project ?? []))].sort();
  return {
    projects: await Promise.all(
      projects.map(async (project) => {
        const statuses = await open.source.projectStatuses(project);
        const settings = settingsFor(open.connection, project);
        const option = (move: TicketMove) => moveOption(statuses, move, settings);
        return {
          project,
          moves: Object.fromEntries(
            ticketMoveSchema.options.map((move) => [move, option(move)]),
          ) as Record<TicketMove, TicketMoveOption>,
        };
      }),
    ),
  };
}
