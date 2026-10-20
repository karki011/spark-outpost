const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MainWindowState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export interface ViewingState {
  main: MainWindowState;
  mainChat: string | null;
  islandChat: string | null;
}

export function parseViewedChat(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && CHAT_ID.test(value) ? value : undefined;
}

export function mainWindowShows(main: MainWindowState): boolean {
  return main.focused && main.visible && !main.minimized;
}

export function viewedChats(state: ViewingState): string[] {
  const viewed = new Set<string>();
  if (state.mainChat && mainWindowShows(state.main)) viewed.add(state.mainChat);
  if (state.islandChat) viewed.add(state.islandChat);
  return [...viewed];
}

export function sameChats(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
