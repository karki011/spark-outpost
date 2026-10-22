import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './theme-menu.css';
import { useTooltip } from '../ui/Tooltip.tsx';
import { useKeepInViewport } from '../ui/viewport-clamp.ts';
import { readAppearance } from './appearance.ts';
import { revealAppearance } from './reveal.ts';
import { modes, tints, type Appearance } from './theme.ts';

const LIGHT = '#f4f5f7';
const DARK = '#12161a';
const MODE_SWATCHES = {
  auto: { accent: LIGHT, background: DARK },
  light: { accent: LIGHT, background: LIGHT },
  dark: { accent: DARK, background: DARK },
};

function swatchStyle(swatch: { accent: string; background: string }): CSSProperties {
  return { '--a': swatch.accent, '--b': swatch.background } as CSSProperties;
}

function Tick() {
  return (
    <svg
      className="tick"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

interface ChoiceProps {
  checked: boolean;
  open: boolean;
  swatch: { accent: string; background: string };
  onSelect: () => void;
  children: ReactNode;
}

function Choice({ checked, open, swatch, onSelect, children }: ChoiceProps) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={open ? 0 : -1}
      onClick={onSelect}
    >
      <span className="sw" style={swatchStyle(swatch)} />
      {children}
      <Tick />
    </button>
  );
}

export function ThemePicker() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const tip = useTooltip('Theme');
  useKeepInViewport(menuRef, open);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    checked?.focus();
  }, [open]);

  const choose = (patch: Partial<Appearance>) => {
    const next = { ...appearance, ...patch };
    setOpen(false);
    buttonRef.current?.focus();
    revealAppearance(next, () => setAppearance(next));
  };

  const moveFocus = (delta: number) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    if (!items || items.length === 0) return;
    const list = Array.from(items);
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = (current + delta + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <div className="theme-menu">
      {tip.tooltip}
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-label="Theme"
        {...tip.triggerProps}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="theme-dot" />
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className={open ? 'pop open' : 'pop'}
        role="menu"
        aria-label="Theme"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            buttonRef.current?.focus();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(-1);
          }
        }}
      >
        <div role="group" aria-label="Appearance">
          {modes.map((mode) => (
            <Choice
              key={mode.id}
              checked={mode.id === appearance.mode}
              open={open}
              swatch={MODE_SWATCHES[mode.id]}
              onSelect={() => choose({ mode: mode.id })}
            >
              {mode.label}
            </Choice>
          ))}
        </div>
        <div role="group" aria-label="Tint" className="theme-menu-tints">
          {tints.map((tint) => (
            <Choice
              key={tint.id}
              checked={tint.id === appearance.tint}
              open={open}
              swatch={tint.swatch}
              onSelect={() => choose({ tint: tint.id })}
            >
              {tint.label}
            </Choice>
          ))}
        </div>
      </div>
    </div>
  );
}
