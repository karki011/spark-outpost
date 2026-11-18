export interface ChatRequest {
  id: string;
  runId: string | null;
}

export type NavigationKind = 'chat' | 'settings';

export interface HeldNavigationDeps {
  locked(): boolean;
  announce(kind: NavigationKind): void;
}

export interface HeldNavigation {
  openChat(request: ChatRequest): void;
  openSettings(target: string): void;
  takeChat(): ChatRequest | null;
  takeSettings(): string | null;
  unlocked(): void;
}

export function heldNavigation(deps: HeldNavigationDeps): HeldNavigation {
  let chat: ChatRequest | null = null;
  let settings: string | null = null;

  return {
    openChat(request) {
      if (deps.locked()) settings = null;
      chat = request;
      if (!deps.locked()) deps.announce('chat');
    },
    openSettings(target) {
      if (deps.locked()) chat = null;
      settings = target;
      if (!deps.locked()) deps.announce('settings');
    },
    takeChat() {
      if (deps.locked()) return null;
      const taken = chat;
      chat = null;
      return taken;
    },
    takeSettings() {
      if (deps.locked()) return null;
      const taken = settings;
      settings = null;
      return taken;
    },
    unlocked() {
      if (chat) deps.announce('chat');
      if (settings) deps.announce('settings');
    },
  };
}
