export const IPC = {
  companionGet: 'companion:get',
  companionSetEnabled: 'companion:set-enabled',
  companionSetCalm: 'companion:set-calm',
  companionSetShortcut: 'companion:set-shortcut',
  companionChanged: 'companion:changed',
  islandInteractive: 'island:interactive',
  islandFocusable: 'island:focusable',
  islandOpenChat: 'island:open-chat',
  islandDrag: 'island:drag',
  islandGeometry: 'island:geometry',
  islandGeometryChanged: 'island:geometry-changed',
  islandCommand: 'island:command',
  openChat: 'spark:open-chat',
  pendingChat: 'spark:pending-chat',
} as const;

export type DragPhase = 'start' | 'move' | 'end';
