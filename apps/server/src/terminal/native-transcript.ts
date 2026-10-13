export interface TokenCounts {
  input: number;
  output: number;
  cachedRead: number;
  cachedWrite: number;
  cachedWriteLong: number;
  thought: number;
}

export interface ReportedModel extends Omit<TokenCounts, 'cachedWriteLong'> {
  model: string;
  costUsd: number | null;
}

export interface ReportedUsage {
  nativeSessionId: string;
  costUsd: number;
  models: ReportedModel[];
}

export type TranscriptRecord =
  | { kind: 'interrupt'; turnId: string }
  | {
      kind: 'response';
      turnId: string | null;
      responseId: string;
      model: string | null;
      tokens: TokenCounts;
    }
  | { kind: 'agent'; agentId: string; turnId: string }
  | { kind: 'reported'; usage: ReportedUsage };

export interface TranscriptParser {
  push(line: string): TranscriptRecord[];
}

export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

export function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
