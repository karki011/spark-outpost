import type { LocalRuntime } from './runtime-client.ts';
import { OutputTail, type ServiceOptions } from './service.ts';
import { Supervisor } from './supervisor.ts';

export class RuntimeServices {
  private readonly supervisors: Supervisor[] = [];

  constructor(
    private readonly runtime: LocalRuntime,
    private readonly failure: (message: string, detail: string) => void,
    private readonly log: (line: string) => void,
  ) {}

  start(options: ServiceOptions, ready: () => boolean) {
    const tail = new OutputTail();
    const supervisor = new Supervisor({
      start: () =>
        this.runtime.service({
          ...options,
          log: (line) => {
            tail.push(line);
            options.log(line);
          },
        }),
      onRestart: (delayMs, code) => {
        if (!ready()) {
          this.failure(`${options.name} stopped during startup (exit ${code}).`, tail.text());
          return;
        }
        this.log(`${options.name} exited with ${code}; restarting in ${delayMs} ms.`);
      },
      onGiveUp: (code) =>
        this.failure(`${options.name} keeps stopping (last exit ${code}).`, tail.text()),
    });
    this.supervisors.push(supervisor);
    supervisor.start();
  }

  async once(options: ServiceOptions) {
    const tail = new OutputTail();
    const service = this.runtime.service({
      ...options,
      log: (line) => {
        tail.push(line);
        options.log(line);
      },
    });
    const code = await service.exited;
    return code === 0
      ? { ok: true as const }
      : { ok: false as const, detail: tail.text() || `The migration exited with ${code}.` };
  }

  async stop() {
    await Promise.all(this.supervisors.map((supervisor) => supervisor.stop()));
  }
}
