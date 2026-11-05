export interface LabelSegment {
  text: string;
  code: boolean;
}

export function parseLabelSegments(label: string): LabelSegment[] {
  const segments: LabelSegment[] = [];
  const pattern = /`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(label))) {
    if (match.index > cursor)
      segments.push({ text: label.slice(cursor, match.index), code: false });
    segments.push({ text: match[1] ?? '', code: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < label.length) segments.push({ text: label.slice(cursor), code: false });
  return segments;
}

export type VerifyLogLineStatus = 'pending' | 'good' | 'bad';

export interface VerifyLogLine {
  id: number;
  label: string;
  status: VerifyLogLineStatus;
}

export function appendLogLine(lines: VerifyLogLine[], id: number, label: string): VerifyLogLine[] {
  return [...lines, { id, label, status: 'pending' }];
}

export function resolveLastLine(
  lines: VerifyLogLine[],
  label: string,
  status: 'good' | 'bad',
): VerifyLogLine[] {
  const last = lines.at(-1);
  if (!last) return lines;
  return [...lines.slice(0, -1), { ...last, label, status }];
}

export function methodLabel(method: 'cli' | 'api_key'): string {
  return method === 'cli' ? 'local CLI' : 'API key';
}

export function methodTitle(method: 'cli' | 'api_key'): string {
  return method === 'cli' ? 'Local CLI' : 'API key';
}

export const ENDPOINT_TITLE = 'Endpoint';

export function isEndpoint(setup: { id: string }): boolean {
  return setup.id === 'custom';
}

export function connectionTitle(setup: { id: string }, method: 'cli' | 'api_key'): string {
  return isEndpoint(setup) ? ENDPOINT_TITLE : methodTitle(method);
}
