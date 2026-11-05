import './controls.css';
import './secret-warning.css';
import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { SecretGuard } from './use-secret-guard.ts';

const KIND_NAMES: Record<string, string> = {
  api_key: 'an API key',
  aws_key: 'an AWS key',
  github_token: 'a GitHub token',
  slack_token: 'a Slack token',
  jwt: 'a token',
  bearer: 'a token',
  token: 'a token',
  private_key: 'a private key',
  password: 'a password',
  url_password: 'a password',
};

function secretWarningText(kinds: readonly string[]): string {
  const named = new Set(kinds.map((kind) => KIND_NAMES[kind] ?? 'a secret'));
  const [only] = named;
  return named.size === 1 && only ? `This looks like ${only}.` : 'This looks like it has secrets.';
}

interface SecretWarningProps {
  guard: SecretGuard;
  input: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  onSendAnyway: () => void;
}

export function SecretWarning({ guard, input, onText, onSendAnyway }: SecretWarningProps) {
  if (!guard.kinds) return null;
  const backToInput = () => input.current?.focus({ preventScroll: true });
  return (
    <SecretNote
      kinds={guard.kinds}
      onRemove={() => {
        onText(guard.remove());
        backToInput();
      }}
      onSendAnyway={() => {
        guard.allow();
        onSendAnyway();
      }}
      onCancel={() => {
        guard.dismiss();
        backToInput();
      }}
    />
  );
}

interface SecretNoteProps {
  kinds: readonly string[];
  onRemove: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

function SecretNote({ kinds, onRemove, onSendAnyway, onCancel }: SecretNoteProps) {
  const removeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => removeRef.current?.focus({ preventScroll: true }), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  };
  return (
    <div className="secret-warn" role="alert" onKeyDown={onKeyDown}>
      <p>
        <b>{secretWarningText(kinds)}</b> Messages go to the agent’s provider and stay in the chat.
        Paste API keys in Settings → AI providers instead.
      </p>
      <div className="secret-warn-acts">
        <button ref={removeRef} type="button" className="btn sm primary" onClick={onRemove}>
          Remove it
        </button>
        <button type="button" className="btn sm ghost" onClick={onSendAnyway}>
          Send anyway
        </button>
      </div>
    </div>
  );
}
