import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './theme-menu.css';
import { useTooltip } from '../ui/Tooltip.tsx';
import { revealTheme } from './reveal.ts';
import { readTheme, themes, type ThemeId } from './theme.ts';

function swatchStyle(swatch: { accent: string; background: string }): CSSProperties {
  return { '--a': swatch.accent, '--b': swatch.background } as CSSProperties;
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const tip = useTooltip('Theme');

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

  const selectTheme = (next: ThemeId) => {
    setOpen(false);
    buttonRef.current?.focus();
    revealTheme(next, () => setTheme(next));
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
        {themes.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitemradio"
            aria-checked={option.id === theme}
            tabIndex={open ? 0 : -1}
            onClick={() => selectTheme(option.id)}
          >
            <span className="sw" style={swatchStyle(option.swatch)} />
            {option.label}
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
          </button>
        ))}
      </div>
    </div>
  );
}
