import {
  AGENT_TERMINAL_STORED_CHARS,
  createOutputSanitizer,
  outputTail,
} from '@spark-outpost/contracts';
import { storableText } from '../audit/redact.ts';
import { createRedactionFilter } from '../audit/redact-stream.ts';
import { createReplayBuffer } from './replay-buffer.ts';

export const AGENT_TERMINAL_REPLAY_CHARS = 256_000;

export interface AgentTerminalRecord {
  push(data: string): void;
  finish(): void;
  readonly replay: string;
  readonly tail: string;
  readonly total: number;
}

export function createAgentTerminalRecord(secretValues: readonly string[]): AgentTerminalRecord {
  const sanitizer = createOutputSanitizer();
  const redaction = createRedactionFilter(secretValues);
  const replay = createReplayBuffer(AGENT_TERMINAL_REPLAY_CHARS);
  let tail = '';
  let total = 0;

  const keep = (clean: string) => {
    const text = storableText(clean);
    if (text === '') return;
    tail = outputTail(tail + text, AGENT_TERMINAL_STORED_CHARS);
    total += text.length;
  };

  return {
    push(data) {
      replay.push(data);
      keep(redaction.push(sanitizer.push(data)));
    },
    finish: () => keep(redaction.finish()),
    get replay() {
      return replay.text();
    },
    get tail() {
      return tail;
    },
    get total() {
      return total;
    },
  };
}
