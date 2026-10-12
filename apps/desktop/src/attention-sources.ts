import type { AttentionReport } from '@spark-outpost/contracts';

export interface AttentionSources<Source> {
  has(source: Source): boolean;
  report(source: Source, report: AttentionReport): void;
  gone(source: Source): AttentionReport | null;
}

export function attentionSources<Source>(): AttentionSources<Source> {
  const reports = new Map<Source, AttentionReport>();
  return {
    has: (source) => reports.has(source),
    report(source, report) {
      reports.delete(source);
      reports.set(source, report);
    },
    gone(source) {
      reports.delete(source);
      return [...reports.values()].at(-1) ?? null;
    },
  };
}
