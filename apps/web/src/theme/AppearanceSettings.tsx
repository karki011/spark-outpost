import { useId, useState, useSyncExternalStore } from 'react';
import { SettingRow } from '../settings/SettingRow.tsx';
import { Segmented } from '../ui/Segmented.tsx';
import { readAppearance, systemLook } from './appearance.ts';
import { revealAppearance } from './reveal.ts';
import {
  contrastChoices,
  modes,
  tints,
  type Appearance,
  type ContrastChoice,
  type Mode,
  type SkinId,
  type SystemLook,
} from './theme.ts';
import './theme-cards.css';

export const MODE_LABEL = 'Appearance';
export const TINT_LABEL = 'Tint';
export const CONTRAST_LABEL = 'Increase contrast';
export const APPEARANCE_ROWS = [MODE_LABEL, TINT_LABEL, CONTRAST_LABEL] as const;

const MODE_OPTIONS = modes.map(({ id, label }) => ({ id, label }));
const CONTRAST_OPTIONS = contrastChoices.map(({ id, label }) => ({ id, label }));
const QUERIES = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'];

function subscribeToSystem(onChange: () => void): () => void {
  const lists = QUERIES.map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener('change', onChange));
  return () => lists.forEach((list) => list.removeEventListener('change', onChange));
}

let cachedLook: SystemLook | null = null;

function currentLook(): SystemLook {
  const next = systemLook();
  if (cachedLook?.dark !== next.dark || cachedLook.moreContrast !== next.moreContrast) {
    cachedLook = next;
  }
  return cachedLook;
}

function useSystemLook(): SystemLook {
  return useSyncExternalStore(subscribeToSystem, currentLook);
}

function isMode(id: string): id is Mode {
  return modes.some((mode) => mode.id === id);
}

function isContrast(id: string): id is ContrastChoice {
  return contrastChoices.some((choice) => choice.id === id);
}

function modeHint(system: SystemLook): string {
  const now = system.dark ? 'dark' : 'light';
  return `Automatic follows macOS, or your phone and browser. It's ${now} right now.`;
}

function contrastHint(appearance: Appearance, system: SystemLook): string {
  if (appearance.contrast === 'always') return 'Always uses the high-contrast set.';
  if (system.moreContrast) {
    return 'On because Increase contrast is on in your system settings. Uses the high-contrast set.';
  }
  return 'Uses the high-contrast set when Increase contrast is on in your system settings.';
}

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

function TintPreview({ light, dark }: { light: SkinId; dark: SkinId }) {
  return (
    <span className="tprev split">
      <span data-skin={light} className="tprev-half">
        <Miniature />
      </span>
      <span data-skin={dark} className="tprev-half">
        <Miniature />
      </span>
    </span>
  );
}

export function AppearanceSettings() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const system = useSystemLook();
  const modeHintId = useId();
  const tintTitleId = useId();
  const contrastHintId = useId();

  const choose = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    revealAppearance(next, () => setAppearance(next));
  };

  return (
    <div className="appearance">
      <SettingRow label={MODE_LABEL} hint={modeHint(system)} hintId={modeHintId}>
        <Segmented
          ariaLabel={MODE_LABEL}
          describedBy={modeHintId}
          options={MODE_OPTIONS}
          value={appearance.mode}
          onChange={(id) => {
            if (isMode(id)) choose({ mode: id });
          }}
        />
      </SettingRow>
      <section className="tints" aria-labelledby={tintTitleId}>
        <h3 id={tintTitleId} className="tints-title">
          {TINT_LABEL} <span>Each tint has a light and a dark side</span>
        </h3>
        <div className="themes-grid" role="radiogroup" aria-label={TINT_LABEL}>
          {tints.map((tint) => (
            <button
              key={tint.id}
              type="button"
              role="radio"
              aria-checked={tint.id === appearance.tint}
              className="tcard"
              onClick={() => choose({ tint: tint.id })}
            >
              <TintPreview light={tint.light} dark={tint.dark} />
              <b>{tint.label}</b>
              <small>{tint.description}</small>
            </button>
          ))}
        </div>
      </section>
      <SettingRow
        label={CONTRAST_LABEL}
        hint={contrastHint(appearance, system)}
        hintId={contrastHintId}
      >
        <Segmented
          ariaLabel={CONTRAST_LABEL}
          describedBy={contrastHintId}
          options={CONTRAST_OPTIONS}
          value={appearance.contrast}
          onChange={(id) => {
            if (isContrast(id)) choose({ contrast: id });
          }}
        />
      </SettingRow>
    </div>
  );
}
