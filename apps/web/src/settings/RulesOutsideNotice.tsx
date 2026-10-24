import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OutsideChangeAnswer, OutsideChangeView } from '@spark-outpost/contracts';
import { sparkRulesApi, sparkRulesKey } from '../api/spark-rules.ts';
import { useRemoteClient } from '../phone/use-remote-client.ts';
import { WarnIcon } from '../ui/icons.tsx';
import { RuleDiffList } from '../chat/approvals/RulesEditFacts.tsx';

export const OUTSIDE_TITLE = 'Rules file changed outside Spark';
const OUTSIDE_TEXT =
  'Spark keeps using the rules you last accepted, or its recommended rules if you never accepted any, until you choose. Something other than Spark changed settings.json, perhaps an agent in a mode Spark can’t see.';

function ChangeList({ change }: { change: OutsideChangeView }) {
  if (change.added.length === 0 && change.removed.length === 0) {
    return <p className="rules-outside-text">No rule changed; only the file’s text did.</p>;
  }
  return <RuleDiffList add={change.added} remove={change.removed} label="Changes in the file" />;
}

export function RulesOutsideNotice({ change }: { change: OutsideChangeView }) {
  const headingId = useId();
  const queryClient = useQueryClient();
  const { remote } = useRemoteClient();
  const [open, setOpen] = useState(false);
  const answer = useMutation({
    mutationFn: (keep: OutsideChangeAnswer['keep']) =>
      sparkRulesApi.answerOutside({ keep, fileHash: change.fileHash }),
    onSuccess: (rules) => queryClient.setQueryData(sparkRulesKey, rules),
  });
  return (
    <section className="rules-outside" role="status" aria-labelledby={headingId}>
      <p className="rules-outside-h" id={headingId}>
        <WarnIcon />
        {OUTSIDE_TITLE}
      </p>
      <p className="rules-outside-text">{OUTSIDE_TEXT}</p>
      {remote ? (
        <p className="rules-outside-text">Review it on your Mac.</p>
      ) : open ? (
        <>
          <ChangeList change={change} />
          <div className="appr-acts">
            <button
              type="button"
              className="btn primary sm"
              disabled={answer.isPending}
              onClick={() => answer.mutate('file')}
            >
              Use the changed file
            </button>
            <button
              type="button"
              className="btn line sm"
              disabled={answer.isPending}
              onClick={() => answer.mutate('spark')}
            >
              Put back the accepted rules
            </button>
          </div>
        </>
      ) : (
        <button type="button" className="btn line sm" onClick={() => setOpen(true)}>
          Review
        </button>
      )}
      {answer.isError && (
        <p className="appr-err" role="alert">
          {answer.error.message}
        </p>
      )}
    </section>
  );
}
