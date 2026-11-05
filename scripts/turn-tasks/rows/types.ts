export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
  numbers: Record<string, number | string | null>;
  notObserved?: true;
}

export interface CommandTiming {
  id: string;
  runId: string;
  command: string;
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  status: string;
}

export interface OutputEvent {
  commandId: string;
  at: number;
}

export interface LogRow {
  runId: string;
  seq: number;
  at: number;
  direction: string;
  kind: string;
  method: string | null;
  payload: unknown;
  unreviewed: boolean;
}

export function result(
  name: string,
  pass: boolean,
  detail: string,
  numbers: CheckResult['numbers'] = {},
): CheckResult {
  return { name, pass, detail, numbers };
}

export function notObserved(name: string, detail: string): CheckResult {
  return { name, pass: false, notObserved: true, detail, numbers: {} };
}

export function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
