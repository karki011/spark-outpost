type Chord = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'code'>;

export function matchesDiffShortcut(event: Chord, mac: boolean): boolean {
  const modifier = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return modifier && !event.altKey && event.code === 'KeyD';
}
