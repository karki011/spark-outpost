import type { ControlClient } from './control-client.ts';

const MODE_FORMAT =
  '#{history_size} #{alternate_on} #{cursor_x} #{cursor_y} #{keypad_flag} [#{pane_private_modes}]';
const REPLAYED_MODES = new Set([1, 6, 7, 9, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004]);
const CURSOR_SHOWN = 25;
const RESET = '\x1b[0m';
const ENTER_ALTERNATE = '\x1b[?1049h\x1b[H';

export interface PaneModes {
  historySize: number;
  alternate: boolean;
  cursorX: number;
  cursorY: number;
  keypad: boolean;
  privateModes: number[];
}

export function parseModes(line: string): PaneModes {
  const [history, alternate, cursorX, cursorY, keypad, modes = '[]'] = line.trim().split(' ');
  return {
    historySize: Number(history) || 0,
    alternate: alternate === '1',
    cursorX: Number(cursorX) || 0,
    cursorY: Number(cursorY) || 0,
    keypad: keypad === '1',
    privateModes: modes
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map(Number)
      .filter((mode) => Number.isInteger(mode)),
  };
}

export function modeSequences(modes: PaneModes): string {
  const set = modes.privateModes.filter((mode) => REPLAYED_MODES.has(mode));
  return [
    `\x1b[${modes.cursorY + 1};${modes.cursorX + 1}H`,
    modes.privateModes.includes(CURSOR_SHOWN) ? '\x1b[?25h' : '\x1b[?25l',
    ...set.map((mode) => `\x1b[?${mode}h`),
    modes.keypad ? '\x1b=' : '',
  ].join('');
}

export function seedText(replies: readonly (readonly string[])[]): string {
  const [modeLines = [], scrolled = [], saved = [], visible = []] = replies;
  const modes = parseModes(modeLines[0] ?? '');
  const history = modes.historySize === 0 ? [] : scrolled;
  const before = modes.alternate ? [...history, ...saved] : history;
  const rows = (lines: readonly string[]) => lines.map((line) => `${RESET}${line}`).join('\r\n');
  const earlier = before.length > 0 ? `${rows(before)}\r\n` : '';
  const screen = modes.alternate ? `${ENTER_ALTERNATE}${rows(visible)}` : rows(visible);
  return `${earlier}${screen}${RESET}${modeSequences(modes)}`;
}

export function requestSeed(
  client: ControlClient,
  paneId: string,
  onSeed: (seed: string) => void,
): void {
  const replies: string[][] = [];
  const collect = (lines: string[] | null) => replies.push(lines ?? []);
  const capture = (extra: string) => `capture-pane -p -e -N -t ${paneId} ${extra}`.trim();
  client.command(`display-message -p -t ${paneId} '${MODE_FORMAT}'`, collect);
  client.command(capture('-S - -E -1'), collect);
  client.command(capture('-a -q'), collect);
  client.command(capture(''), (lines) => {
    collect(lines);
    onSeed(seedText(replies));
  });
}
