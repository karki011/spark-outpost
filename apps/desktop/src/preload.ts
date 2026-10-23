import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type DragPhase } from './ipc-channels.ts';
import { applySeed } from './storage-seed.ts';
import { hourCycleFromArgs } from './hour-cycle-arg.ts';
import { themeFromArgs } from './theme-arg.ts';

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

function restoreSettings(): void {
  try {
    const entries: unknown = ipcRenderer.sendSync(IPC.storageSeed);
    if (entries && typeof entries === 'object')
      applySeed(localStorage, entries as Record<string, string>);
  } catch {
    return;
  }
}

restoreSettings();

contextBridge.exposeInMainWorld('sparkDesktop', {
  platform: process.platform,
  theme: {
    saved: themeFromArgs(process.argv),
    save: (theme: string) => ipcRenderer.send(IPC.themeSave, theme),
  },
  rendered: () => ipcRenderer.send(IPC.appRendered),
  companion: {
    get: () => ipcRenderer.invoke(IPC.companionGet),
    setEnabled: (on: boolean) => ipcRenderer.invoke(IPC.companionSetEnabled, on),
    setShortcut: (action: string, accelerator: string | null) =>
      ipcRenderer.invoke(IPC.companionSetShortcut, action, accelerator),
    setSound: (on: boolean) => ipcRenderer.invoke(IPC.companionSetSound, on),
    setIslandSize: (size: string) => ipcRenderer.invoke(IPC.companionSetIslandSize, size),
    setAutoExpand: (on: boolean) => ipcRenderer.invoke(IPC.companionSetAutoExpand, on),
    setHideInShare: (on: boolean) => ipcRenderer.invoke(IPC.companionSetHideInShare, on),
    setNotify: (on: boolean) => ipcRenderer.invoke(IPC.companionSetNotify, on),
    onChange: (callback: (status: unknown) => void) => listen(IPC.companionChanged, callback),
  },
  attention: {
    report: (report: unknown) => ipcRenderer.send(IPC.attentionReport, report),
  },
  meetingAlert: {
    show: (payload: unknown) => ipcRenderer.send(IPC.meetingAlertShow, payload),
    hide: () => ipcRenderer.send(IPC.meetingAlertHide),
    onAction: (callback: (action: unknown) => void) => listen(IPC.meetingAlertAction, callback),
    presence: () => ipcRenderer.invoke(IPC.presenceGet),
    autoJoined: () => ipcRenderer.send(IPC.meetingAutoJoined),
    onPayload: (callback: (payload: unknown) => void) => listen(IPC.meetingAlertPayload, callback),
    onPlace: (callback: (place: unknown) => void) => listen(IPC.meetingAlertPlace, callback),
    onLeave: (callback: () => void) => listen(IPC.meetingAlertLeave, callback),
    act: (action: unknown) => ipcRenderer.send(IPC.meetingAlertAct, action),
    gone: () => ipcRenderer.send(IPC.meetingAlertGone),
    ready: () => ipcRenderer.send(IPC.meetingAlertReady),
    focus: () => ipcRenderer.send(IPC.meetingAlertFocus),
    onTakeFocus: (callback: () => void) => listen(IPC.meetingAlertTakeFocus, callback),
    setRegions: (regions: unknown) => ipcRenderer.send(IPC.meetingAlertRegions, regions),
    pointerMoved: () => ipcRenderer.send(IPC.meetingAlertPointerMoved),
  },
  clock: {
    hourCycle: hourCycleFromArgs(process.argv),
    onHourCycle: (callback: (cycle: unknown) => void) => listen(IPC.hourCycleChanged, callback),
  },
  viewing: {
    report: (chatId: string | null) => ipcRenderer.send(IPC.viewingReport, chatId),
    get: () => ipcRenderer.invoke(IPC.viewedGet),
    onChange: (callback: (viewed: unknown) => void) => listen(IPC.viewedChanged, callback),
  },
  island: {
    geometry: () => ipcRenderer.invoke(IPC.islandGeometry),
    onGeometry: (callback: (geometry: unknown) => void) =>
      listen(IPC.islandGeometryChanged, callback),
    onCommand: (callback: (action: unknown) => void) => listen(IPC.islandCommand, callback),
    onEscape: (callback: () => void) => listen(IPC.islandEscape, callback),
    onPointer: (callback: (point: unknown) => void) => listen(IPC.islandPointer, callback),
    sparkFocused: () => ipcRenderer.invoke(IPC.islandSparkFocused),
    pathForFile: (file: File) => webUtils.getPathForFile(file) || null,
    onSparkFocus: (callback: (focused: unknown) => void) => listen(IPC.islandSparkFocus, callback),
    setInteractive: (on: boolean) => ipcRenderer.send(IPC.islandInteractive, on),
    setRegions: (regions: unknown) => ipcRenderer.send(IPC.islandRegions, regions),
    pointerMoved: () => ipcRenderer.send(IPC.islandPointerMoved),
    setFocusable: (on: boolean) => ipcRenderer.send(IPC.islandFocusable, on),
    drag: (phase: DragPhase, x: number, y: number) => ipcRenderer.send(IPC.islandDrag, phase, x, y),
    openChat: (id: string | null, runId?: string) =>
      ipcRenderer.send(IPC.islandOpenChat, id, runId ?? null),
    openSettings: (target: string) => ipcRenderer.send(IPC.islandOpenSettings, target),
    setRestSize: (size: { width: number; height: number } | null) =>
      ipcRenderer.send(IPC.islandRestSize, size),
    ready: () => ipcRenderer.send(IPC.islandReady),
  },
  updates: {
    get: () => ipcRenderer.invoke(IPC.updatesGet),
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    setChannel: (channel: string) => ipcRenderer.invoke(IPC.updatesSetChannel, channel),
    setAutoDownload: (on: boolean) => ipcRenderer.invoke(IPC.updatesSetAutoDownload, on),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    preview: () => ipcRenderer.invoke(IPC.updatesPreview),
    onChange: (callback: (status: unknown) => void) => listen(IPC.updatesChanged, callback),
  },
  privacy: {
    openFullDiskAccess: () => ipcRenderer.invoke(IPC.privacyOpenFullDiskAccess),
  },
  macControl: {
    status: () => ipcRenderer.invoke(IPC.macControlStatus),
    prompt: () => ipcRenderer.invoke(IPC.macControlPrompt),
    openSettings: () => ipcRenderer.invoke(IPC.macControlOpenSettings),
    stop: () => ipcRenderer.invoke(IPC.macControlStop),
    resume: () => ipcRenderer.invoke(IPC.macControlResume),
    indicator: () => ipcRenderer.invoke(IPC.macControlIndicator),
    onIndicator: (callback: (state: unknown) => void) =>
      listen(IPC.macControlIndicatorChanged, callback),
  },
  speech: {
    status: () => ipcRenderer.invoke(IPC.voiceStatus),
    turnOn: () => ipcRenderer.invoke(IPC.voiceTurnOn),
    turnOff: () => ipcRenderer.invoke(IPC.voiceTurnOff),
    update: (patch: unknown) => ipcRenderer.invoke(IPC.voiceUpdate, patch),
    listen: (purpose: string, hint: string, file?: string) =>
      ipcRenderer.invoke(IPC.voiceListen, purpose, hint, file),
    stop: (id: string) => ipcRenderer.invoke(IPC.voiceStop, id),
    cancel: (id: string) => ipcRenderer.invoke(IPC.voiceCancel, id),
    speak: (text: string) => ipcRenderer.invoke(IPC.voiceSpeak, text),
    hush: () => ipcRenderer.invoke(IPC.voiceHush),
    testPress: (file: string) => ipcRenderer.invoke(IPC.voiceTestPress, file),
    openSettings: (page: string) => ipcRenderer.invoke(IPC.voiceOpenSettings, page),
    onEvent: (callback: (event: unknown) => void) => listen(IPC.voiceEvent, callback),
    onChange: (callback: (status: unknown) => void) => listen(IPC.voiceChanged, callback),
  },
  browser: {
    state: (chatId: string) => ipcRenderer.invoke(IPC.browserState, chatId),
    place: (placement: unknown) => ipcRenderer.invoke(IPC.browserPlace, placement),
    command: (chatId: string, command: unknown) =>
      ipcRenderer.invoke(IPC.browserCommand, chatId, command),
    start: (placement: unknown) => ipcRenderer.invoke(IPC.browserStart, placement),
    sites: () => ipcRenderer.invoke(IPC.browserSites),
    signOut: (origin: string | null) => ipcRenderer.invoke(IPC.browserSignOut, { origin }),
    onState: (callback: (state: unknown) => void) => listen(IPC.browserStateChanged, callback),
    onSnapshot: (callback: (snapshot: unknown) => void) => listen(IPC.browserSnapshot, callback),
    onPicked: (callback: (pick: unknown) => void) => listen(IPC.browserPicked, callback),
    onSelectedText: (callback: (selected: unknown) => void) =>
      listen(IPC.browserSelectedText, callback),
    onShortcut: (callback: (event: unknown) => void) => listen(IPC.browserShortcut, callback),
    onFound: (callback: (found: unknown) => void) => listen(IPC.browserFound, callback),
  },
  browserView: {
    state: (profile: string) => ipcRenderer.invoke(IPC.browserViewState, profile),
    place: (placement: unknown) => ipcRenderer.invoke(IPC.browserViewPlace, placement),
    command: (profile: string, command: unknown) =>
      ipcRenderer.invoke(IPC.browserViewCommand, profile, command),
    start: (profile: string) => ipcRenderer.invoke(IPC.browserViewStart, profile),
    handToChat: (request: unknown) => ipcRenderer.invoke(IPC.browserViewHand, request),
    fromChat: (request: unknown) => ipcRenderer.invoke(IPC.browserToView, request),
    pageText: (profile: string, tabId: string) =>
      ipcRenderer.invoke(IPC.browserViewPageText, profile, tabId),
    onIntent: (callback: (intent: unknown) => void) => listen(IPC.browserViewIntent, callback),
    onState: (callback: (state: unknown) => void) => listen(IPC.browserViewStateChanged, callback),
    onSnapshot: (callback: (snapshot: unknown) => void) =>
      listen(IPC.browserViewSnapshot, callback),
    onShortcut: (callback: (event: unknown) => void) => listen(IPC.browserViewShortcut, callback),
    onFound: (callback: (found: unknown) => void) => listen(IPC.browserViewFound, callback),
  },
  help: {
    info: () => ipcRenderer.invoke(IPC.helpInfo),
    exportDiagnostics: () => ipcRenderer.invoke(IPC.helpExportDiagnostics),
    showLogs: () => ipcRenderer.invoke(IPC.helpShowLogs),
  },
  menu: {
    onCommand: (callback: (command: unknown) => void) => listen(IPC.menuCommand, callback),
    reportSidebar: (shown: boolean) => ipcRenderer.send(IPC.menuSidebarShown, shown),
  },
  settingsWindow: {
    open: (route: string, focus: string | null) =>
      ipcRenderer.send(IPC.settingsWindowOpen, route, focus),
    take: () => ipcRenderer.invoke(IPC.settingsWindowTake),
    onChange: (callback: () => void) => listen(IPC.settingsWindowChanged, callback),
    openChat: (id: string) => ipcRenderer.send(IPC.settingsWindowOpenChat, id),
    openDoc: (link: string) => ipcRenderer.send(IPC.settingsWindowOpenDoc, link),
    onDoc: (callback: (link: string) => void) => {
      const take = () =>
        void ipcRenderer.invoke(IPC.settingsWindowTakeDoc).then((link: unknown) => {
          if (typeof link === 'string') callback(link);
        });
      take();
      return listen(IPC.settingsWindowDoc, take);
    },
  },
  onOpenSettings: (callback: (target: string) => void) => {
    const take = () =>
      void ipcRenderer.invoke(IPC.pendingSettings).then((target: unknown) => {
        if (typeof target === 'string') callback(target);
      });
    take();
    return listen(IPC.openSettings, take);
  },
  onOpenChat: (callback: (id: string, runId: string | null) => void) => {
    const take = () =>
      void ipcRenderer.invoke(IPC.pendingChat).then((pending: unknown) => {
        const { id, runId } = (pending ?? {}) as { id?: unknown; runId?: unknown };
        if (typeof id === 'string') callback(id, typeof runId === 'string' ? runId : null);
      });
    take();
    return listen(IPC.openChat, take);
  },
});
