const TAIL_LINES = 40;

export interface ServiceOptions {
  name: string;
  bootstrap: string;
  entry: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  log: (line: string) => void;
  connect?: (port: ServicePort) => ServiceLink;
}

export interface ServicePort {
  post(message: unknown): void;
}

export interface ServiceLink {
  receive(message: unknown): void;
  close(): void;
}

export class OutputTail {
  private readonly lines: string[] = [];

  push(chunk: string): string[] {
    const added = chunk.split('\n').filter((line) => line.trim() !== '');
    this.lines.push(...added);
    this.lines.splice(0, Math.max(0, this.lines.length - TAIL_LINES));
    return added;
  }

  text(): string {
    return this.lines.join('\n');
  }
}
