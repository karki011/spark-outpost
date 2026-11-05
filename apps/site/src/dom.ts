export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const element = el('button', className, text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

export function frame(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = el('div', 'window');
  const bar = el('div', 'window-bar');
  bar.append(el('span', 'dots'), el('span', 'window-title', title));
  const body = el('div', 'window-body');
  root.append(bar, body);
  return { root, body };
}
