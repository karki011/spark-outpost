const VIEW_RESYNC = '\x1b[0m\r\n';
const SCREEN_SWITCH = new RegExp(`${String.fromCharCode(27)}\\[\\?(?:1049|1047|47)[hl]`, 'g');
const LONGEST_SWITCH = 8;

export interface ViewHold {
  output(data: string): void;
  pause(): void;
  resume(): void;
}

export function createViewHold(send: (data: string) => void): ViewHold {
  let held = false;
  let tail = '';
  let lastSwitch = '';
  const note = (data: string) => {
    const text = tail + data;
    const found = text.match(SCREEN_SWITCH);
    if (found) lastSwitch = found[found.length - 1]!;
    tail = text.slice(-(LONGEST_SWITCH - 1));
  };
  return {
    output: (data) => {
      if (held) note(data);
      else send(data);
    },
    pause: () => {
      held = true;
    },
    resume: () => {
      if (!held) return;
      held = false;
      send(lastSwitch + VIEW_RESYNC);
      tail = '';
      lastSwitch = '';
    },
  };
}
