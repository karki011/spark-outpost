const CHAT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAIN_CHATS_MAX = 2;

export interface MainWindowState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export interface ViewingState {
  main: MainWindowState;
  mainChats: readonly string[];
  islandChat: string | null;
}

export function parseViewedChat(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && CHAT_ID.test(value) ? value : undefined;
}

export function parseViewedChats(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    const chat = parseViewedChat(value);
    if (chat === undefined) return undefined;
    return chat === null ? [] : [chat];
  }
  if (value.length > MAIN_CHATS_MAX) return undefined;
  const chats = value.map(parseViewedChat);
  if (!chats.every((chat): chat is string => typeof chat === 'string')) return undefined;
  return [...new Set(chats)];
}

export function mainWindowShows(main: MainWindowState): boolean {
  return main.focused && main.visible && !main.minimized;
}

export function viewedChats(state: ViewingState): string[] {
  const viewed = new Set<string>();
  if (mainWindowShows(state.main)) for (const chat of state.mainChats) viewed.add(chat);
  if (state.islandChat) viewed.add(state.islandChat);
  return [...viewed];
}

export function sameChats(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
