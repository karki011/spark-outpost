import { useState } from 'react';
import { revealTheme } from './reveal.ts';
import { readTheme, themes, type ThemeId } from './theme.ts';
import './theme-cards.css';

function Miniature() {
  return (
    <span className="tmini" aria-hidden="true">
      <i className="tmini-side">
        <i className="tmini-row active" />
        <i className="tmini-row" />
        <i className="tmini-row" />
      </i>
      <i className="tmini-panel">
        <i className="tmini-title" />
        <i className="tmini-bubble" />
        <i className="tmini-line wide" />
        <i className="tmini-line" />
        <i className="tmini-composer">
          <i className="tmini-send" />
        </i>
      </i>
    </span>
  );
}

function ThemePreview({ id }: { id: ThemeId }) {
  if (id === 'system') {
    return (
      <span className="tprev split">
        <span data-skin="light" className="tprev-half">
          <Miniature />
        </span>
        <span data-skin="dark" className="tprev-half">
          <Miniature />
        </span>
      </span>
    );
  }
  return (
    <span className="tprev" data-skin={id}>
      <Miniature />
    </span>
  );
}

export function ThemeCards() {
  const [selected, setSelected] = useState<ThemeId>(readTheme);

  return (
    <div className="themes-grid" role="radiogroup" aria-label="Theme">
      {themes.map((theme) => (
        <button
          key={theme.id}
          type="button"
          role="radio"
          aria-checked={theme.id === selected}
          className="tcard"
          onClick={() => revealTheme(theme.id, () => setSelected(theme.id))}
        >
          <ThemePreview id={theme.id} />
          <b>{theme.label}</b>
          <small>{theme.description}</small>
        </button>
      ))}
    </div>
  );
}
