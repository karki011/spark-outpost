import type { ControlClient } from './control-client.ts';

const MODE_FORMAT =
  '#{history_size} #{alternate_on} #{cursor_x} #{cursor_y} #{keypad_flag} [#{pane_private_modes}]';
const REPLAYED_MODES = new Set([1, 6, 7, 9, 1000, 1002, 1003, 1004, 1005, 1006, 1015, 1016, 2004]);
const CURSOR_SHOWN = 25;
const RESET = '\x1b[0m';
const ENTER_ALTERNATE = '\x1b[?1049h\x1b[H';
const SEED_HISTORY_LINES = 2000;
const ROW_END = '\r\n';

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

function newestWithin(lines: readonly string[], maxBytes: number): readonly string[] {
  let bytes = 0;
  let from = lines.length;
  while (from > 0) {
    bytes += Buffer.byteLength(lines[from - 1]!, 'utf8') + RESET.length + 2;
    if (bytes > maxBytes) break;
    from -= 1;
  }
  return from === 0 ? lines : lines.slice(from);
}

function screenRows(visible: readonly string[], maxBytes: number) {
  let kept = newestWithin(visible, maxBytes);
  const skippedBytes = () => (visible.length - kept.length) * ROW_END.length;
  while (kept.length > 0 && kept.length < visible.length) {
    if (rowBytes(kept) + skippedBytes() <= maxBytes) break;
    kept = kept.slice(1);
  }
  const skipped = kept.length === 0 ? '' : ROW_END.repeat(visible.length - kept.length);
  return { kept, skipped };
}

function rowBytes(lines: readonly string[]): number {
  return lines.reduce(
    (sum, line) => sum + Buffer.byteLength(line, 'utf8') + RESET.length + ROW_END.length,
    0,
  );
}

export function seedText(
  replies: readonly (readonly string[])[],
  maxBytes = Number.POSITIVE_INFINITY,
): string {
  const [modeLines = [], scrolled = [], saved = [], visible = []] = replies;
  const modes = parseModes(modeLines[0] ?? '');
  const history = modes.historySize === 0 ? [] : scrolled;
  const rows = (lines: readonly string[]) => lines.map((line) => `${RESET}${line}`).join('\r\n');
  const tail = `${RESET}${modeSequences(modes)}`;
  const opening = modes.alternate ? ENTER_ALTERNATE : '';
  const shown = screenRows(visible, maxBytes - Buffer.byteLength(`${opening}${tail}`, 'utf8'));
  const screen = `${opening}${shown.skipped}${rows(shown.kept)}`;
  const after = `${screen}${tail}`;
  const before = newestWithin(
    modes.alternate ? [...history, ...saved] : history,
    maxBytes - Buffer.byteLength(after, 'utf8'),
  );
  const earlier = before.length > 0 ? `${rows(before)}\r\n` : '';
  return `${earlier}${after}`;
}

export function requestSeed(
  client: ControlClient,
  paneId: string,
  onSeed: (seed: string | null) => void,
  maxBytes = Number.POSITIVE_INFINITY,
): void {
  const replies: string[][] = [];
  let complete = true;
  const collect = (lines: string[] | null) => {
    if (!lines) complete = false;
    replies.push(lines ?? []);
  };
  const capture = (extra: string) => `capture-pane -p -e -N -t ${paneId} ${extra}`.trim();
  client.command(`display-message -p -t ${paneId} '${MODE_FORMAT}'`, collect);
  client.command(capture(`-S -${SEED_HISTORY_LINES} -E -1`), collect);
  client.command(capture('-a -q'), collect);
  client.command(capture(''), (lines) => {
    collect(lines);
    onSeed(complete ? seedText(replies, maxBytes) : null);
  });
}
