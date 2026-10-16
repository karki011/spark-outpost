import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SearchIcon, XIcon } from '../ui/icons.tsx';
import { searchSettings, type SearchableSection, type SettingsMatch } from './settings-search.ts';
import type { SettingsSection } from './settings-sections.tsx';

type Match = SettingsMatch<SettingsSection>;

interface SettingsSearchProps {
  sections: readonly SearchableSection<SettingsSection>[];
  query: string;
  onQuery: (query: string) => void;
  onChoose: (match: Match) => void;
}

function matchKey(match: Match): string {
  return `${match.section}:${match.row ?? ''}`;
}

function countText(count: number, query: string): string {
  if (count === 0) return `No settings match “${query.trim()}”.`;
  return `${count} ${count === 1 ? 'result' : 'results'}`;
}

export function SettingsSearch({ sections, query, onQuery, onChoose }: SettingsSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [active, setActive] = useState(0);
  const matches = useMemo(() => searchSettings(query, sections), [query, sections]);
  const searching = query.trim() !== '';
  const listed = searching && matches.length > 0;
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (!listed) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [listed, listId, activeIndex]);

  const choose = (match: Match) => {
    onQuery('');
    setActive(0);
    onChoose(match);
    if (!match.row) input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      onQuery('');
      setActive(0);
      return;
    }
    if (!listed) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + matches.length) % matches.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(matches[activeIndex]!);
    }
  };

  return (
    <>
      <label className="set-find">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          role="combobox"
          value={query}
          placeholder="Search settings"
          aria-label="Search settings"
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed ? optionId(activeIndex) : undefined}
          enterKeyHint="go"
          onChange={(event) => {
            onQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {query && (
          <button
            type="button"
            className="set-find-clear"
            aria-label="Clear search"
            onClick={() => {
              onQuery('');
              setActive(0);
              input.current?.focus();
            }}
          >
            <XIcon />
          </button>
        )}
      </label>
      {searching && (
        <div className="set-results">
          <p className="set-results-count" role="status">
            {countText(matches.length, query)}
          </p>
          {listed && (
            <ul id={listId} role="listbox" aria-label="Matching settings">
              {matches.map((match, index) => (
                <li
                  key={matchKey(match)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(match)}
                >
                  <span className="set-result-label">{match.row ?? match.sectionLabel}</span>{' '}
                  <span className="set-result-where">
                    {match.row ? `${match.groupLabel} · ${match.sectionLabel}` : match.groupLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
