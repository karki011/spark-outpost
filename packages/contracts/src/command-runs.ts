import { z } from 'zod';

export const COMMAND_STARTED = 'command_started';
export const COMMAND_OUTPUT = 'command_output';
export const COMMAND_FINISHED = 'command_finished';

export const COMMAND_TEXT_MAX = 4_000;
export const COMMAND_STORED_CHARS = 64 * 1024;
export const COMMAND_LIVE_CHARS = 1024 * 1024;
export const COMMAND_CHUNK_CHARS = 32 * 1024;
export const COMMAND_BROWSER_CHARS = 256 * 1024;

export const commandStatusSchema = z.enum(['running', 'completed', 'failed', 'interrupted']);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

const anchorFields = {
  textOffset: z.number().int().nonnegative().nullable(),
  textBefore: z.string().nullable(),
  textHeld: z.number().int().nonnegative().nullable(),
};

export const commandStartedSchema = z.object({
  id: z.uuid(),
  command: z.string().max(COMMAND_TEXT_MAX),
  cwd: z.string().nullable(),
  live: z.boolean(),
  startedAt: z.string(),
  ...anchorFields,
});
export type CommandStarted = z.infer<typeof commandStartedSchema>;

export const commandOutputSchema = z.object({
  id: z.uuid(),
  at: z.number().int().nonnegative(),
  chunk: z.string(),
  reset: z.boolean().optional(),
});
export type CommandOutput = z.infer<typeof commandOutputSchema>;

export const commandFinishedSchema = z.object({
  id: z.uuid(),
  status: commandStatusSchema.exclude(['running']),
  exitCode: z.number().int().nullable(),
  finishedAt: z.string(),
  outputChars: z.number().int().nonnegative(),
});
export type CommandFinished = z.infer<typeof commandFinishedSchema>;

export const commandRunSchema = commandStartedSchema.extend({
  runId: z.uuid(),
  status: commandStatusSchema,
  exitCode: z.number().int().nullable(),
  finishedAt: z.string().nullable(),
  outputChars: z.number().int().nonnegative(),
});
export type CommandRun = z.infer<typeof commandRunSchema>;

export const commandOutputResponseSchema = z.object({
  output: z.string(),
  outputChars: z.number().int().nonnegative(),
});
export type CommandOutputResponse = z.infer<typeof commandOutputResponseSchema>;

const ESC = '\u001b';
const KEPT_CONTROLS = new Set(['\n', '\r', '\t', '\b']);
const KEPT_CSI_FINALS = new Set(['m', 'K', 'A', 'B', 'C', 'D', 'G']);
const STRING_OPENERS = new Set([']', 'P', 'X', '^', '_']);
const PLAIN_CSI_PARAMS = /^[0-9;:]*$/;
const CSI_MAX = 64;

type SanitizerMode = 'ground' | 'escape' | 'csi' | 'intermediate' | 'string' | 'string_escape';

export interface OutputSanitizer {
  push(chunk: string): string;
}

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function hasControls(chunk: string): boolean {
  for (let index = 0; index < chunk.length; index++) {
    const code = chunk.charCodeAt(index);
    if (isControl(code) && code !== 0x0a && code !== 0x0d && code !== 0x09) return true;
  }
  return false;
}

export function createOutputSanitizer(): OutputSanitizer {
  let mode: SanitizerMode = 'ground';
  let csi = '';

  const afterEscape = (char: string): SanitizerMode => {
    if (char === '[') {
      csi = '';
      return 'csi';
    }
    if (STRING_OPENERS.has(char)) return 'string';
    const code = char.charCodeAt(0);
    return code >= 0x20 && code <= 0x2f ? 'intermediate' : 'ground';
  };

  const inCsi = (char: string): string => {
    const code = char.charCodeAt(0);
    if (code >= 0x40 && code <= 0x7e) {
      mode = 'ground';
      const kept = KEPT_CSI_FINALS.has(char) && PLAIN_CSI_PARAMS.test(csi);
      return kept ? `${ESC}[${csi}${char}` : '';
    }
    if (isControl(code) || csi.length >= CSI_MAX) {
      mode = char === ESC ? 'escape' : 'ground';
      return '';
    }
    csi += char;
    return '';
  };

  const step = (char: string): string => {
    const code = char.charCodeAt(0);
    switch (mode) {
      case 'ground':
        if (char === ESC) mode = 'escape';
        else if (!isControl(code) || KEPT_CONTROLS.has(char)) return char;
        return '';
      case 'escape':
        mode = afterEscape(char);
        return '';
      case 'csi':
        return inCsi(char);
      case 'intermediate':
        if (code < 0x20 || code > 0x2f) mode = char === ESC ? 'escape' : 'ground';
        return '';
      case 'string':
        if (char === ESC) mode = 'string_escape';
        else if (char === '\u0007' || char === '\u009c') mode = 'ground';
        return '';
      case 'string_escape':
        mode = char === '\\' ? 'ground' : char === ESC ? 'string_escape' : 'string';
        return '';
    }
  };

  return {
    push(chunk) {
      if (mode === 'ground' && !hasControls(chunk)) return chunk;
      let clean = '';
      for (const char of chunk) clean += step(char);
      return clean;
    },
  };
}

export function sanitizeOutput(text: string): string {
  return createOutputSanitizer().push(text);
}

const CSI_REST = /^\[[0-9;:]*[A-Za-z]/;

function withoutCsi(text: string): string {
  const [first = '', ...rest] = text.split(ESC);
  return first + rest.map((part) => part.replace(CSI_REST, '')).join('');
}

function afterCarriageReturns(line: string): string {
  const overwritten = line.lastIndexOf('\r');
  return overwritten === -1 ? line : line.slice(overwritten + 1);
}

export function plainOutput(text: string): string {
  return withoutCsi(text)
    .replaceAll('\b', '')
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map(afterCarriageReturns)
    .join('\n');
}

const LINE_SEEK = 2_048;

function startsMidPair(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

export function outputTail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let cut = text.length - maxChars;
  const newline = text.indexOf('\n', cut);
  if (newline !== -1 && newline - cut < LINE_SEEK) cut = newline + 1;
  else if (startsMidPair(text, cut)) cut += 1;
  return text.slice(cut);
}
