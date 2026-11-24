export const MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

export function hasModifier(event: { metaKey: boolean; ctrlKey: boolean }, mac = MAC): boolean {
  return mac ? event.metaKey : event.ctrlKey;
}

export type Modifier = 'mod' | 'ctrl' | 'alt' | 'shift';

const MAC_GLYPHS: Record<Modifier, string> = { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const PC_NAMES: Record<Modifier, string> = {
  mod: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
};
const PC_ORDER: readonly string[] = ['Ctrl', 'Alt', 'Shift'];

function isModifier(part: string): part is Modifier {
  return part in MAC_GLYPHS;
}

export function shortcutParts(parts: readonly string[], mac = MAC): string[] {
  if (mac) return parts.map((part) => (isModifier(part) ? MAC_GLYPHS[part] : part));
  const held = new Set(parts.filter(isModifier).map((part) => PC_NAMES[part]));
  const keys = parts.filter((part) => !isModifier(part));
  return [...PC_ORDER.filter((name) => held.has(name)), ...keys];
}

export function shortcutText(parts: readonly string[], mac = MAC, macSeparator = ''): string {
  return shortcutParts(parts, mac).join(mac ? macSeparator : '+');
}
