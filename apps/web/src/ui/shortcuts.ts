export const MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

export function hasModifier(event: KeyboardEvent): boolean {
  return MAC ? event.metaKey : event.ctrlKey;
}
