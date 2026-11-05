import { useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { BrowserPaneTab, BrowserProfile } from '@spark-outpost/contracts';
import { ArrowUpIcon } from '../ui/icons.tsx';
import { SecretWarning } from '../ui/SecretWarning.tsx';
import { restoreFailedDraft } from '../chat/composer/use-chat-draft.ts';
import { useSecretGuard } from '../ui/use-secret-guard.ts';
import {
  MENTIONS_MAX,
  insertMention,
  mentionChoices,
  mentionLabel,
  mentionToken,
  profileName,
  type MentionToken,
} from './ask-tabs.ts';
import { DockChip } from './DockChip.tsx';
import type { PageRef } from './page-chat.ts';

interface MentionComposerProps {
  input: RefObject<HTMLTextAreaElement | null>;
  open: ReadonlyMap<BrowserProfile, readonly BrowserPaneTab[]>;
  mentions: readonly PageRef[];
  onMentions(next: PageRef[]): void;
  busy: boolean;
  onSend(text: string): Promise<unknown>;
  onClose(): void;
}

function pageKey(page: PageRef): string {
  return `${page.profile}:${page.tabId}`;
}

export function MentionComposer(props: MentionComposerProps) {
  const { input, open, mentions, onMentions, busy, onSend, onClose } = props;
  const ids = useId();
  const [text, setText] = useState('');
  const [token, setToken] = useState<MentionToken | null>(null);
  const [active, setActive] = useState(0);
  const caret = useRef(0);
  const secrets = useSecretGuard(text);
  const full = mentions.length >= MENTIONS_MAX;
  const choices = token && !full ? mentionChoices(open, token.query, mentions) : [];
  const listOpen = choices.length > 0;
  const current = Math.min(active, choices.length - 1);

  const track = (value: string, at: number) => {
    caret.current = at;
    setText(value);
    setToken(mentionToken(value, at));
    setActive(0);
  };

  const choose = (page: PageRef) => {
    if (!token) return;
    const next = insertMention(text, token, caret.current, page);
    onMentions([...mentions, page]);
    setText(next.text);
    setToken(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const startMention = () => {
    const field = input.current;
    const at = field?.selectionStart ?? text.length;
    const before = text.slice(0, at);
    const lead = before === '' || /\s$/.test(before) ? '@' : ' @';
    const value = before + lead + text.slice(at);
    track(value, at + lead.length);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(at + lead.length, at + lead.length);
    });
  };

  const submit = () => {
    const question = text.trim();
    if (!question || busy || secrets.blocks(text)) return;
    setToken(null);
    setText('');
    onSend(question).then(
      () => undefined,
      () => setText((current) => restoreFailedDraft(current, question)),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : choices.length - 1;
      setActive((current + step) % choices.length);
      return;
    }
    if (listOpen && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      choose(choices[current]!);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (listOpen) setToken(null);
      else onClose();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      className="pcd-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {mentions.length > 0 && (
        <ul className="pcd-chips" aria-label="Tabs you mentioned">
          {mentions.map((page) => (
            <DockChip
              key={pageKey(page)}
              label={mentionLabel(page) || page.url}
              detail={profileName(page.profile)}
              removeLabel={`Remove ${mentionLabel(page) || page.url}`}
              onRemove={() => {
                onMentions(mentions.filter((other) => pageKey(other) !== pageKey(page)));
                input.current?.focus();
              }}
            />
          ))}
        </ul>
      )}
      <SecretWarning guard={secrets} input={input} onText={setText} onSendAnyway={submit} />
      <div className="atd-field">
        {listOpen && (
          <ul className="atd-list" id={`${ids}-list`} role="listbox" aria-label="Open tabs">
            {choices.map((page, index) => (
              <li
                key={pageKey(page)}
                id={`${ids}-${index}`}
                role="option"
                aria-selected={index === current}
                className="atd-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(page);
                }}
              >
                <span className="atd-option-name">{page.title || page.url}</span>
                <span className="atd-option-kind">{profileName(page.profile)}</span>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={input}
          className="inp pcd-input"
          aria-label="Ask Spark"
          aria-controls={listOpen ? `${ids}-list` : undefined}
          aria-activedescendant={listOpen ? `${ids}-${current}` : undefined}
          aria-autocomplete="list"
          placeholder={full ? 'Ask about these tabs…' : 'Ask about these tabs… type @ to add a tab'}
          rows={3}
          value={text}
          onChange={(event) => track(event.target.value, event.target.selectionStart)}
          onSelect={(event) => {
            caret.current = event.currentTarget.selectionStart;
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="pcd-row">
        <button
          type="button"
          className="btn atd-at"
          disabled={full}
          title={full ? `Up to ${MENTIONS_MAX} tabs` : undefined}
          onClick={startMention}
        >
          @ Mention a tab
        </button>
        <button
          type="submit"
          className="icon-btn pcd-send"
          aria-label="Ask"
          disabled={text.trim() === '' || busy}
        >
          <ArrowUpIcon />
        </button>
      </div>
    </form>
  );
}
