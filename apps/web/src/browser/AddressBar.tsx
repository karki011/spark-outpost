import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addressToUrl, type BrowserPaneTab } from '@spark-outpost/contracts';
import type { PaneCommands } from './pane-shortcuts.ts';

interface AddressBarProps {
  commands: PaneCommands;
  tab: BrowserPaneTab | null;
  placeholder?: string;
}

export function AddressBar({
  commands,
  tab,
  placeholder = 'localhost:5173 or a web address',
}: AddressBarProps) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const url = tab?.url ?? '';

  useEffect(() => {
    const choosing = document.activeElement?.closest('[role="radiogroup"]') ?? null;
    if (tab && tab.url === '' && !tab.loading && !choosing) input.current?.focus();
  }, [tab?.id, tab?.url, tab?.loading, tab]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = draft ?? url;
    if (!addressToUrl(typed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (tab) commands.send({ command: 'navigate', tabId: tab.id, url: typed });
    else commands.send({ command: 'new_tab', url: typed });
    input.current?.blur();
  };

  return (
    <form className="bp-address" onSubmit={submit}>
      <input
        ref={input}
        className="inp bp-url"
        type="text"
        inputMode="url"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        aria-label="Address"
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={placeholder}
        value={draft ?? url}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
        }}
      />
      {invalid && (
        <p id={errorId} className="bp-address-error" role="alert">
          Type a web address, like localhost:5173 or example.com.
        </p>
      )}
    </form>
  );
}
