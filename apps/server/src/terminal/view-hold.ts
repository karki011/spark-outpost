import { FLOW_REDRAW_MAX_BYTES } from './output-flow.ts';
import { createReplayBuffer } from './replay-buffer.ts';

const ESC = String.fromCharCode(27);
const VIEW_RESYNC = `${ESC}[0m\r\n`;
const MODE_SWITCH = new RegExp(`${ESC}\\[\\?(1049|1047|47|25)[hl]`, 'g');
const LONGEST_SWITCH = 8;

export interface ViewHold {
  output(data: string): void;
  pause(): void;
  resume(): void;
}

function fromLineStart(text: string): string {
  const lineEnd = text.indexOf('\n');
  return lineEnd < 0 ? text : text.slice(lineEnd + 1);
}

export function createViewHold(
  send: (data: string) => void,
  limit = FLOW_REDRAW_MAX_BYTES,
): ViewHold {
  let held = false;
  let kept = createReplayBuffer(limit);
  let heldLength = 0;
  let tail = '';
  const modes = new Map<string, string>();
  const keep = (data: string) => {
    kept.push(data);
    heldLength += data.length;
    const text = tail + data;
    for (const found of text.matchAll(MODE_SWITCH)) modes.set(found[1]!, found[0]);
    tail = text.slice(-(LONGEST_SWITCH - 1));
  };
  return {
    output: (data) => {
      if (held) keep(data);
      else send(data);
    },
    pause: () => {
      held = true;
    },
    resume: () => {
      if (!held) return;
      held = false;
      const text = kept.text();
      if (heldLength > limit)
        send([...modes.values()].join('') + VIEW_RESYNC + fromLineStart(text));
      else if (text) send(text);
      kept = createReplayBuffer(limit);
      heldLength = 0;
      tail = '';
      modes.clear();
    },
  };
}
