const SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function escapeBelongsToSurface(event: KeyboardEvent, own: Element | null): boolean {
  if (document.querySelector('[aria-modal="true"]')) return true;
  const target = event.target instanceof Element ? event.target : null;
  const surface = target?.closest(SURFACES);
  return surface != null && !own?.contains(surface);
}
