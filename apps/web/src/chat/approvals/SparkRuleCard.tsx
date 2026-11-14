import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  allowGroupLabel,
  sparkRuleLine,
  type Approval,
  type SparkRuleAnswer,
  type SparkRuleRefusal,
} from '@spark-outpost/contracts';
import { sparkRulesApi, sparkRulesKey } from '../../api/spark-rules.ts';
import { approvalAnchor } from '../../crew/conversation-crew.ts';
import { useRemoteClient } from '../../phone/use-remote-client.ts';
import { CheckIcon, XIcon } from '../../ui/icons.tsx';
import { Breakout } from '../breakout/Breakout.tsx';
import { commandApproval } from '../status/pending-summary.ts';
import { Pending } from '../status/Pending.tsx';
import { Button } from '../../ui/Button.tsx';

const ON_THE_MAC = 'Waiting for you on your Mac. Spark rules change there.';

function answeredLine(answer: SparkRuleAnswer, rule: SparkRuleRefusal): string {
  if (answer === 'keep') return 'Kept refused.';
  if (answer === 'allow_once') return 'Allowed once. The agent runs it again.';
  return rule.group === 'workflows'
    ? 'Workflows now follow the agent’s mode. The agent runs it again.'
    : `${rule.prefix} now follows the agent’s mode. The agent runs it again.`;
}

function Refused({ command, rule, id }: { command: string; rule: SparkRuleRefusal; id: string }) {
  return (
    <span id={id}>
      Spark refused <code>{command}</code> — {sparkRuleLine(rule)}.
    </span>
  );
}

function Answered({ approval, answer }: { approval: Approval; answer: SparkRuleAnswer }) {
  const headingId = useId();
  const rule = approval.payload.sparkRule!;
  const kept = answer === 'keep';
  return (
    <div
      className={kept ? 'appr resolved denied' : 'appr resolved'}
      role="group"
      aria-labelledby={headingId}
      id={approvalAnchor(approval.id)}
    >
      <span className="ic" aria-hidden="true">
        {kept ? <XIcon /> : <CheckIcon />}
      </span>
      <span className="appr-what">
        <Refused command={approval.payload.command ?? ''} rule={rule} id={headingId} />
      </span>
      <span className="appr-res" role="status">
        {answeredLine(answer, rule)}
      </span>
    </div>
  );
}

function Asking({
  approval,
  onAnswered,
}: {
  approval: Approval;
  onAnswered: (answer: SparkRuleAnswer) => void;
}) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const { remote } = useRemoteClient();
  const rule = approval.payload.sparkRule!;
  const answer = useMutation({
    mutationFn: (chosen: SparkRuleAnswer) => sparkRulesApi.answer(approval.id, chosen),
    onSuccess: (_card, chosen) => {
      onAnswered(chosen);
      if (chosen === 'allow_group') void queryClient.invalidateQueries({ queryKey: sparkRulesKey });
    },
  });
  return (
    <Breakout>
      <div
        className="appr"
        role="group"
        aria-labelledby={headingId}
        id={approvalAnchor(approval.id)}
      >
        <div className="appr-top">
          <div className="appr-h">
            <span className="ic" aria-hidden="true">
              <i className="appr-dia" />
            </span>
            <Refused command={approval.payload.command ?? ''} rule={rule} id={headingId} />
          </div>
          {remote ? (
            <p className="appr-reason">{ON_THE_MAC}</p>
          ) : (
            <div className="appr-acts">
              <Button
                tone="soft"
                small
                disabled={answer.isPending}
                onClick={() => answer.mutate('allow_group')}
              >
                {allowGroupLabel(rule)}
              </Button>
              <button
                type="button"
                className="btn line sm"
                disabled={answer.isPending}
                onClick={() => answer.mutate('allow_once')}
              >
                Allow once
              </button>
              <button
                type="button"
                className="btn ghost sm deny"
                disabled={answer.isPending}
                onClick={() => answer.mutate('keep')}
              >
                Keep refused
              </button>
            </div>
          )}
          {answer.isError && (
            <p className="appr-err" role="alert">
              {answer.error.message}
            </p>
          )}
        </div>
        <p className="appr-reason">
          Allow once lets just this command through. Either way the agent is told to run it again.
        </p>
      </div>
    </Breakout>
  );
}

export function SparkRuleCard({ approval }: { approval: Approval }) {
  const [local, setLocal] = useState<SparkRuleAnswer | null>(null);
  const answer = approval.ruleAnswer ?? local;
  if (answer) return <Answered approval={approval} answer={answer} />;
  return (
    <Pending
      id={approval.id}
      order={approval.createdAt}
      summary={{ ...commandApproval(approval.payload.command ?? ''), action: 'answer' }}
      pending
    >
      <Asking approval={approval} onAnswered={setLocal} />
    </Pending>
  );
}
