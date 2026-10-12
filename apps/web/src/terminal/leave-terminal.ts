const TAB_STOPS = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';

function isTabStop(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled')) return false;
  return element.closest('[hidden], [inert], [aria-hidden="true"]') === null;
}

export function focusBeside(
  terminal: HTMLElement,
  backward: boolean,
  root: ParentNode = document,
): boolean {
  const stops = [...root.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(
    (element) => !terminal.contains(element) && isTabStop(element),
  );
  const before = stops.filter(
    (element) => terminal.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING,
  );
  const after = stops.filter(
    (element) => terminal.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const target = backward ? (before.at(-1) ?? after.at(-1)) : (after[0] ?? before[0]);
  target?.focus();
  return target !== undefined;
}
