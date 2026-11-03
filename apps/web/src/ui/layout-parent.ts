export function layoutParent(element: Element): HTMLElement | null {
  let parent = element.parentElement;
  while (parent && getComputedStyle(parent).display === 'contents') parent = parent.parentElement;
  return parent;
}
