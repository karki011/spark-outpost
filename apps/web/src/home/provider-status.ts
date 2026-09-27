import type {
  AdvisorConnection,
  ConnectableId,
  ProviderConnection,
  ProviderIssue,
  ProviderIssueKind,
} from '@spark-outpost/contracts';

export type ProviderStatus = 'ok' | 'warn' | 'off';

export interface StripItem {
  id: ConnectableId;
  name: string;
  status: ProviderStatus;
  model: string | null;
  problem: string | null;
}

const ISSUE_LABEL: Record<ProviderIssueKind, string> = {
  auth: 'Sign-in failed',
  usage_limit: 'Usage limit reached',
  rate_limit: 'Rate limited',
};

export interface ModelOption {
  id: string;
  label: string | null;
}

export function modelLabel(
  connection: Pick<AdvisorConnection, 'model' | 'models'> | null,
  offered: readonly ModelOption[],
  defaultModel: string | null,
): string | null {
  if (!connection) return null;
  const id = connection.model ?? defaultModel;
  if (!id) return 'Agent default';
  const label =
    offered.find((option) => option.id === id)?.label ??
    connection.models.find((option) => option.id === id)?.label;
  return label || id;
}

export function problemText(
  connection: ProviderConnection | AdvisorConnection | null,
  issue: ProviderIssue | null,
  when: (iso: string) => string,
): string | null {
  if (issue) return `${ISSUE_LABEL[issue.kind]} · ${when(issue.at)}`;
  if (connection && 'lastTest' in connection && connection.lastTest?.ok === false) {
    return 'Verify failed';
  }
  return null;
}

export function statusOf(connected: boolean, problem: string | null): ProviderStatus {
  if (!connected) return 'off';
  return problem ? 'warn' : 'ok';
}

const STATUS_LABEL: Record<ProviderStatus, string> = {
  ok: 'Connected',
  warn: 'Needs attention',
  off: 'Not connected',
};

export function stripLabel(item: StripItem): string {
  return [item.name, item.model, STATUS_LABEL[item.status], item.problem]
    .filter(Boolean)
    .join(' · ');
}
