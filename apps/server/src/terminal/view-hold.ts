const VIEW_RESYNC = '\x1b[0m\r\n';

export interface ViewHold {
  output(data: string): void;
  pause(): void;
  resume(): void;
}

export function createViewHold(send: (data: string) => void): ViewHold {
  let held = false;
  return {
    output: (data) => {
      if (!held) send(data);
    },
    pause: () => {
      held = true;
    },
    resume: () => {
      if (!held) return;
      held = false;
      send(VIEW_RESYNC);
    },
  };
}
