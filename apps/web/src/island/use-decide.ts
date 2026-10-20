import { useMutation } from '@tanstack/react-query';
import type { Approval, ApprovalOption, ApprovalScope } from '@spark-outpost/contracts';
import { approvalsApi } from '../api/approvals.ts';
import { shownOptions } from '../chat/approvals/approval-outcome.ts';

export interface Decided {
  title: string;
  sub: string;
}

export function findOption(approval: Approval, kind: ApprovalOption['kind']) {
  return shownOptions(approval).find((option) => option.kind === kind && !option.unavailableReason);
}

export function useDecide(
  approval: Approval | null,
  onDecided: (decided: Decided) => void,
  who: string,
) {
  return useMutation({
    mutationFn: ({
      option,
      scope,
    }: {
      option: ApprovalOption;
      scope: ApprovalScope;
      said?: Decided;
    }) =>
      approvalsApi.decide(approval!.id, {
        optionId: option.optionId,
        scope,
        payloadHash: approval!.payloadHash,
      }),
    onSuccess: (_result, { option, scope, said }) => {
      const allowed = option.kind.startsWith('allow');
      if (said) {
        onDecided(said);
      } else if (scope === 'project') {
        onDecided({ title: 'Allowed in this project', sub: 'It won’t ask again here.' });
      } else if (allowed) {
        onDecided({ title: 'Allowed once', sub: `${who} carries on.` });
      } else {
        onDecided({ title: 'Denied', sub: `${who} will try another way.` });
      }
    },
  });
}
