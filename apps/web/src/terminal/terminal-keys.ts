const IME_KEY_CODE = 229;

const commandSequences: Record<string, string> = {
  Backspace: '\u0015',
  ArrowLeft: '\u0001',
  ArrowRight: '\u0005',
};

type KeyEventLike = Pick<
  KeyboardEvent,
  'type' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'keyCode'
>;

export function lineEditingSequence(event: KeyEventLike): string | null {
  if (event.isComposing || event.keyCode === IME_KEY_CODE) return null;
  if (!event.metaKey || event.ctrlKey || event.altKey) return null;
  return commandSequences[event.key] ?? null;
}

export type TabAction = 'send' | 'leave';

export function tabAction(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey'>,
): TabAction | null {
  if (event.key !== 'Tab') return null;
  return event.altKey && !event.ctrlKey && !event.metaKey ? 'leave' : 'send';
}
