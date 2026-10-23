import type { TaskItemState } from '@spark-outpost/contracts';
import { AgentBlob } from '../brand/AgentBlob.tsx';
import { CheckIcon } from '../ui/icons.tsx';

const stateNames: Record<TaskItemState, string> = {
  done: 'Done',
  active: 'Working',
  waiting: 'Waiting for you',
  pending: 'Not started',
  failed: 'Not finished',
};

export function TaskStateIcon({
  state,
  label = stateNames[state],
}: {
  state: TaskItemState;
  label?: string;
}) {
  if (state === 'done') {
    return (
      <span className="ic" role="img" aria-label={label}>
        <CheckIcon />
      </span>
    );
  }
  if (state === 'active') return <span className="ic spin" role="img" aria-label={label} />;
  if (state === 'waiting') return <span className="ic dia" role="img" aria-label={label} />;
  if (state === 'failed') {
    return (
      <span className="ic errdot" role="img" aria-label={label}>
        !
      </span>
    );
  }
  return <span className="ic pend" role="img" aria-label={label} />;
}

export function HarnessIcon() {
  return (
    <span className="hxic" aria-hidden="true">
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z" />
      </svg>
    </span>
  );
}

export function WhoIcon({ provider }: { provider: string | undefined }) {
  if (!provider) return <HarnessIcon />;
  return (
    <span className="mb" aria-hidden="true">
      <AgentBlob provider={provider} size={16} />
    </span>
  );
}

export function PanelIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M15 4v16M18 8.5h-.01M18 12h-.01" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.46-1.1-1.46-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.56 9.56 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
