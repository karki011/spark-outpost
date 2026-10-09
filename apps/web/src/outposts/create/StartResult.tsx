import type { FailedMember } from '@spark-outpost/contracts';
import { countLabel } from '../../ui/count-label.ts';

interface StartResultProps {
  name: string;
  failed: readonly FailedMember[];
}

export function StartResult({ name, failed }: StartResultProps) {
  return (
    <section className="op-step" aria-label="Result">
      <h3 className="op-step-title" role="alert">
        {name} started. {countLabel(failed.length, 'thing')} did not work.
      </h3>
      <ul className="op-failed">
        {failed.map((failure) => (
          <li key={failure.conversationId}>
            <b>@{failure.handle}</b>
            <span>{failure.message}</span>
          </li>
        ))}
      </ul>
      <p className="op-step-lede">
        Try again to add what is missing. Nothing that already started is repeated. You can also
        open the outpost and add chats there.
      </p>
    </section>
  );
}
