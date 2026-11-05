export const CODE_BYTES = 256 * 1024;
export const JSON_BYTES = 256 * 1024;
export const ERROR_CHARS = 2048;
export const CPU_SLICE_MS = 1000;
export const MAX_PENDING = 128;

export interface ExecutionResult {
  value?: unknown;
  error?: string;
}

export type WorkerRequest = { type: 'reply'; id: number; json?: string; error?: string };
export type WorkerResponse =
  | { type: 'call'; id: number; name: string; json: string }
  | { type: 'result'; result: ExecutionResult };

export function boundedJson(value: unknown): string {
  let size = 0;
  let nodes = 0;
  const parents: object[] = [];
  const json = JSON.stringify(value, function (this: unknown, key: string, item: unknown) {
    while (parents.length && parents.at(-1) !== this) parents.pop();
    if (item !== null && typeof item === 'object') {
      if (parents.length >= 64) throw new Error('JSON result is nested too deeply.');
      parents.push(item);
    }
    nodes += 1;
    size += Buffer.byteLength(key) + (typeof item === 'string' ? Buffer.byteLength(item) : 8);
    if (size > JSON_BYTES || nodes > JSON_BYTES / 8) throw new Error('JSON result is too large.');
    return item;
  });
  if (json === undefined) return 'null';
  if (Buffer.byteLength(json) > JSON_BYTES) throw new Error('JSON result is too large.');
  return json;
}
