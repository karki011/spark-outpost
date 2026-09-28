import { ShipControl } from '../../ship/ShipControl.tsx';
import type { KeepCardHost } from './feedback-host.ts';
import { TurnFeedback } from './TurnFeedback.tsx';

interface KeepCardFooterProps {
  runId: string;
  host: KeepCardHost;
  taskId: string | null;
  conversationId: string;
}

export function KeepCardFooter({ runId, host, taskId, conversationId }: KeepCardFooterProps) {
  return (
    <>
      <TurnFeedback runId={runId} variant={host.variant} />
      {host.variant === 'kept' && taskId && (
        <ShipControl taskId={taskId} conversationId={conversationId} />
      )}
    </>
  );
}
