import type { BrowserShot } from '@spark-outpost/contracts';
import { anchorIndex, outsideFence, type TextAnchor } from '../../browser/shot-order.ts';
import type { AgentTerminalView } from './agent-terminal-model.ts';
import type { CommandView } from './command-model.ts';

export type TurnPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'shots'; key: string; shots: BrowserShot[] }
  | { kind: 'command'; key: string; command: CommandView }
  | { kind: 'terminal'; key: string; terminal: AgentTerminalView };

type Placed =
  | { kind: 'shot'; at: number; time: number; shot: BrowserShot }
  | { kind: 'command'; at: number; time: number; command: CommandView }
  | { kind: 'terminal'; at: number; time: number; terminal: AgentTerminalView };

function placeIn(text: string, anchor: TextAnchor): number {
  return outsideFence(text, anchorIndex(text, anchor) ?? text.length);
}

function placed(
  text: string,
  shots: readonly BrowserShot[],
  commands: readonly CommandView[],
  terminals: readonly AgentTerminalView[],
): Placed[] {
  const items: Placed[] = [
    ...shots.map((shot): Placed => {
      return { kind: 'shot', at: placeIn(text, shot), time: Date.parse(shot.createdAt), shot };
    }),
    ...commands.map((command): Placed => {
      const time = Date.parse(command.startedAt);
      return { kind: 'command', at: placeIn(text, command), time, command };
    }),
    ...terminals.map((terminal): Placed => {
      const time = Date.parse(terminal.startedAt);
      return { kind: 'terminal', at: placeIn(text, terminal), time, terminal };
    }),
  ];
  return items.sort((left, right) => left.at - right.at || left.time - right.time);
}

export function turnParts(
  text: string,
  shots: readonly BrowserShot[],
  commands: readonly CommandView[],
  terminals: readonly AgentTerminalView[] = [],
): TurnPart[] {
  const parts: TurnPart[] = [];
  let from = 0;
  let texts = 0;
  const addText = (to: number) => {
    const slice = text.slice(from, to);
    from = to;
    if (slice.trim() === '') return;
    parts.push({ kind: 'text', key: `text-${texts}`, text: slice });
    texts += 1;
  };
  for (const item of placed(text, shots, commands, terminals)) {
    addText(item.at);
    if (item.kind === 'command') {
      parts.push({ kind: 'command', key: `command-${item.command.id}`, command: item.command });
      continue;
    }
    if (item.kind === 'terminal') {
      parts.push({
        kind: 'terminal',
        key: `terminal-${item.terminal.id}`,
        terminal: item.terminal,
      });
      continue;
    }
    const last = parts.at(-1);
    if (last?.kind === 'shots') last.shots.push(item.shot);
    else parts.push({ kind: 'shots', key: `shots-${item.shot.id}`, shots: [item.shot] });
  }
  addText(text.length);
  return parts;
}
