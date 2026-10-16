import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'input, select, textarea, button, [tabindex]:not([tabindex="-1"])';
const PRIMARY = '[role="switch"], [role="radio"][aria-checked="true"], input:checked';

const NONE: readonly string[] = [];

let pendingLabel: string | null = null;
const listeners = new Set<() => void>();

export function requestSettingFocus(label: string): void {
  pendingLabel = label;
  listeners.forEach((listener) => listener());
}

export function clearSettingFocus(): void {
  pendingLabel = null;
}

function controlToFocus(scope: HTMLElement): HTMLElement | null {
  const enabled = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => !element.matches(':disabled'),
  );
  return enabled.find((element) => element.matches(PRIMARY)) ?? enabled[0] ?? null;
}

function reveal(row: HTMLElement, control: HTMLElement | null): void {
  row.setAttribute('data-found', '');
  const clear = (event: FocusEvent) => {
    if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
    row.removeAttribute('data-found');
    row.removeEventListener('focusout', clear);
  };
  row.addEventListener('focusout', clear);
  row.scrollIntoView({ block: 'center' });
  const target = control ? controlToFocus(control) : null;
  target?.focus({ preventScroll: true });
}

export function useSettingFocus(
  label: string,
  row: RefObject<HTMLElement | null>,
  control: RefObject<HTMLElement | null>,
  standsFor: readonly string[] = NONE,
): void {
  useEffect(() => {
    const take = () => {
      if (pendingLabel === null || !row.current) return;
      if (pendingLabel !== label && !standsFor.includes(pendingLabel)) return;
      pendingLabel = null;
      reveal(row.current, control.current);
    };
    listeners.add(take);
    take();
    return () => {
      listeners.delete(take);
    };
  }, [label, row, control, standsFor]);
}
