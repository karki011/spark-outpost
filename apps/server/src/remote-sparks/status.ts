import type { RemoteSpark } from '@spark-outpost/contracts';

interface RemoteSparkReport {
  status: 'online' | 'offline';
  needsYou: number;
}

export type RemoteSparkState = Pick<RemoteSpark, 'status' | 'needsYou'>;

interface RemoteSparkStatuses {
  report(id: string, report: RemoteSparkReport): void;
  drop(id: string): void;
  clear(): void;
  of(id: string, paired: boolean): RemoteSparkState;
}

export function remoteSparkStatuses(): RemoteSparkStatuses {
  const reports = new Map<string, RemoteSparkReport>();
  return {
    report: (id, report) => {
      reports.set(id, { status: report.status, needsYou: report.needsYou });
    },
    drop: (id) => {
      reports.delete(id);
    },
    clear: () => reports.clear(),
    of: (id, paired) => {
      if (!paired) return { status: 'not-paired', needsYou: 0 };
      const report = reports.get(id);
      if (!report) return { status: 'checking', needsYou: 0 };
      return { status: report.status, needsYou: report.status === 'online' ? report.needsYou : 0 };
    },
  };
}
