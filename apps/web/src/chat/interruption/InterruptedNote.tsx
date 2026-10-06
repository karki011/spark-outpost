import type { ConversationDetail, Run } from '@spark-outpost/contracts';
import { turnAnchor } from '../outline/outline-model.ts';
import { aftermath } from './interruption-model.ts';

interface InterruptedNoteProps {
  run: Run;
  detail: ConversationDetail;
}

export function InterruptedNote({ run, detail }: InterruptedNoteProps) {
  const after = aftermath(run, detail);
  if (!after || after.kind === 'undecided') return null;
  if (after.kind === 'continued') {
    return (
      <p className="ai-note">
        Interrupted before finishing. <a href={`#${turnAnchor(after.runId)}`}>Continued below</a>.
      </p>
    );
  }
  return (
    <p className="ai-note">
      {after.kind === 'fresh'
        ? 'Interrupted before finishing. You started fresh, so the next message opens a new agent session.'
        : 'Interrupted before finishing. Nothing was retried.'}
    </p>
  );
}
