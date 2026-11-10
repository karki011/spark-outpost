import type {
  AdvisorConnection,
  ProviderConnection,
  ProviderIssue,
  ProviderIssueKind,
} from '@spark-outpost/contracts';

const ISSUE_LABEL: Record<ProviderIssueKind, string> = {
  auth: 'Sign-in failed',
  usage_limit: 'Usage limit reached',
  rate_limit: 'Rate limited',
};

interface ModelOption {
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

type AnyConnection = ProviderConnection | AdvisorConnection;

function signedInAt(connection: AnyConnection): number {
  const verified = Date.parse(connection.verifiedAt);
  const test = 'lastTest' in connection ? connection.lastTest : null;
  return test?.ok ? Math.max(verified, Date.parse(test.testedAt)) : verified;
}

export function liveIssue(
  connection: AnyConnection | null,
  issue: ProviderIssue | null,
): ProviderIssue | null {
  if (!issue || issue.kind !== 'auth' || !connection) return issue;
  return signedInAt(connection) > Date.parse(issue.at) ? null : issue;
}

export function problemText(
  connection: AnyConnection | null,
  reported: ProviderIssue | null,
  when: (iso: string) => string,
): string | null {
  const issue = liveIssue(connection, reported);
  if (issue) return `${ISSUE_LABEL[issue.kind]} · ${when(issue.at)}`;
  if (connection && 'lastTest' in connection && connection.lastTest?.ok === false) {
    return 'Verify failed';
  }
  return null;
}
