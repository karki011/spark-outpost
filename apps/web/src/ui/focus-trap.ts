interface TabKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault(): void;
}

export function wrapTabFocus(event: TabKeyEvent, focusables: () => readonly HTMLElement[]): void {
  if (event.key !== 'Tab') return;
  const items = focusables();
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
