import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { addressToUrl, type BrowserPaneTab, type BrowserProfile } from '@spark-outpost/contracts';
import { usePaneId } from '../chat/split/chat-pane.ts';
import {
  AddressSuggestions,
  stepSuggestion,
  useAddressSuggestions,
} from './AddressSuggestions.tsx';
import type { PaneCommands } from './pane-shortcuts.ts';

interface AddressBarProps {
  commands: PaneCommands;
  tab: BrowserPaneTab | null;
  placeholder?: string;
  history?: BrowserProfile | null;
}

export function AddressBar({
  commands,
  tab,
  placeholder = 'localhost:5173 or a web address',
  history = null,
}: AddressBarProps) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = usePaneId('bp-address-suggestions');
  const found = useAddressSuggestions(history, focused ? draft : null);
  const chosen = found[active] ?? null;
  const input = useRef<HTMLInputElement>(null);
  const url = tab?.url ?? '';

  useEffect(() => {
    const choosing = document.activeElement?.closest('[role="radiogroup"]') ?? null;
    if (tab && tab.url === '' && !tab.loading && !choosing) input.current?.focus();
  }, [tab?.id, tab?.url, tab?.loading, tab]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const typed = chosen?.url ?? draft ?? url;
    if (!addressToUrl(typed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (tab) commands.send({ command: 'navigate', tabId: tab.id, url: typed });
    else commands.send({ command: 'new_tab', url: typed });
    input.current?.blur();
  };
  const pick = (picked: string) => {
    if (tab) commands.send({ command: 'navigate', tabId: tab.id, url: picked });
    else commands.send({ command: 'new_tab', url: picked });
    setDraft(picked);
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
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={found.length > 0}
        aria-controls={found.length > 0 ? listId : undefined}
        aria-activedescendant={chosen ? `${listId}-${active}` : undefined}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        placeholder={placeholder}
        value={draft ?? url}
        onChange={(event) => {
          setDraft(event.target.value);
          setActive(-1);
          setInvalid(false);
        }}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setDraft(null);
          const next = stepSuggestion(active, found.length, event.key);
          if (next === null) return;
          event.preventDefault();
          setActive(next);
        }}
      />
      {found.length > 0 && (
        <AddressSuggestions
          id={listId}
          entries={found}
          active={active}
          onActive={setActive}
          onPick={pick}
        />
      )}
      {invalid && (
        <p id={errorId} className="bp-address-error" role="alert">
          Type a web address, like localhost:5173 or example.com.
        </p>
      )}
    </form>
  );
}
