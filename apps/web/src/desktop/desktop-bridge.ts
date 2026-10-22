import type {
  AttentionReport,
  BrowserCommand,
  BrowserPaneState,
  BrowserPick,
  BrowserPlacement,
  BrowserSelectedText,
  DesktopHelpInfo,
  DiagnosticsExport,
  InstallResult,
  IslandRegions,
  IslandSize,
  MeetingAlertAction,
  MeetingAlertPayload,
  MacControlStatus,
  MacIndicator,
  SignedInSite,
  UpdateChannel,
  UpdateStatus,
} from '@spark-outpost/contracts';

export type IslandAction = 'quick' | 'sessions';

export type IslandSettingsTarget =
  'island' | 'sparks' | 'spark-new' | 'connectors' | `spark-edit:${string}` | `today:${string}`;

export type { IslandSize };

export interface CompanionStatus {
  supported: boolean;
  enabled: boolean;
  shortcuts: Record<IslandAction, string>;
  failed: IslandAction[];
  sound?: boolean;
  islandSize?: IslandSize;
  autoExpand?: boolean;
  hideInShare?: boolean;
  notify?: boolean;
  notifyBlocked?: boolean;
}

export type ShortcutResult = { ok: true } | { ok: false; error: string };

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  notchHeight?: number;
  docked: boolean;
  menuBar: number;
  windowTop?: number;
}

type Unsubscribe = () => void;

export interface BrowserSnapshot {
  chatId: string;
  image: string | null;
}

export interface DesktopBrowser {
  state(chatId: string): Promise<BrowserPaneState | null>;
  place(placement: BrowserPlacement): Promise<unknown>;
  command(chatId: string, command: BrowserCommand): Promise<unknown>;
  start(placement: BrowserPlacement): Promise<BrowserPaneState | null>;
  sites(): Promise<SignedInSite[] | null>;
  signOut(origin: string | null): Promise<SignedInSite[] | null>;
  onState(callback: (state: BrowserPaneState) => void): Unsubscribe;
  onSnapshot(callback: (snapshot: BrowserSnapshot) => void): Unsubscribe;
  onPicked(callback: (pick: BrowserPick) => void): Unsubscribe;
  onSelectedText(callback: (selected: BrowserSelectedText) => void): Unsubscribe;
  onShortcut(callback: (event: unknown) => void): Unsubscribe;
  onFound(callback: (found: unknown) => void): Unsubscribe;
}

export interface DesktopMacControl {
  status(): Promise<MacControlStatus | null>;
  prompt(): Promise<MacControlStatus | null>;
  openSettings(): Promise<void>;
  stop(): Promise<void>;
  resume(): Promise<void>;
  indicator(): Promise<MacIndicator | null>;
  onIndicator(callback: (state: MacIndicator | null) => void): Unsubscribe;
}

export interface SparkDesktop {
  platform: string;
  theme?: {
    saved: string | null;
    save(theme: string): void;
  };
  rendered?(): void;
  companion: {
    get(): Promise<CompanionStatus | null>;
    setEnabled(on: boolean): Promise<CompanionStatus>;
    setShortcut(action: IslandAction, accelerator: string | null): Promise<ShortcutResult>;
    setSound?(on: boolean): Promise<CompanionStatus>;
    setIslandSize?(size: IslandSize): Promise<CompanionStatus>;
    setAutoExpand?(on: boolean): Promise<CompanionStatus>;
    setHideInShare?(on: boolean): Promise<CompanionStatus>;
    setNotify?(on: boolean): Promise<CompanionStatus>;
    onChange(callback: (status: CompanionStatus) => void): Unsubscribe;
  };
  attention?: {
    report(report: AttentionReport): void;
  };
  meetingAlert?: {
    show(payload: MeetingAlertPayload): void;
    hide(): void;
    onAction(callback: (action: unknown) => void): Unsubscribe;
    presence(): Promise<unknown>;
    autoJoined(): void;
    onPayload(callback: (payload: unknown) => void): Unsubscribe;
    onPlace(callback: (place: unknown) => void): Unsubscribe;
    onLeave(callback: () => void): Unsubscribe;
    act(action: MeetingAlertAction): void;
    gone(): void;
    ready(): void;
    focus(): void;
    onTakeFocus(callback: () => void): Unsubscribe;
    setRegions(regions: IslandRegions): void;
    pointerMoved(): void;
  };
  clock?: {
    hourCycle: unknown;
    onHourCycle(callback: (cycle: unknown) => void): Unsubscribe;
  };
  viewing?: {
    report(chatId: string | null): void;
    get(): Promise<unknown>;
    onChange(callback: (viewed: unknown) => void): Unsubscribe;
  };
  island: {
    geometry(): Promise<IslandGeometry | null>;
    onGeometry(callback: (geometry: IslandGeometry) => void): Unsubscribe;
    onCommand(callback: (action: IslandAction) => void): Unsubscribe;
    onEscape(callback: () => void): Unsubscribe;
    onPointer?(callback: (point: { x: number; y: number }) => void): Unsubscribe;
    sparkFocused(): Promise<boolean>;
    pathForFile(file: File): string | null;
    onSparkFocus(callback: (focused: boolean) => void): Unsubscribe;
    setInteractive(on: boolean): void;
    setRegions?(regions: IslandRegions): void;
    pointerMoved?(): void;
    setFocusable(on: boolean): void;
    drag(phase: 'start' | 'lift' | 'move' | 'end', x: number, y: number): void;
    openChat(id: string | null, runId?: string): void;
    openSettings?(target: IslandSettingsTarget): void;
    setRestSize(size: { width: number; height: number } | null): void;
    ready?(): void;
  };
  updates: {
    get(): Promise<UpdateStatus | null>;
    check(): Promise<UpdateStatus | null>;
    setChannel(channel: UpdateChannel): Promise<UpdateStatus | null>;
    setAutoDownload(on: boolean): Promise<UpdateStatus | null>;
    install(): Promise<InstallResult>;
    preview(): Promise<UpdateStatus | null>;
    onChange(callback: (status: UpdateStatus) => void): Unsubscribe;
  };
  help?: {
    info(): Promise<DesktopHelpInfo | null>;
    exportDiagnostics(): Promise<DiagnosticsExport | null>;
    showLogs(): Promise<void>;
    onOpenFeedback(callback: () => void): Unsubscribe;
  };
  privacy?: {
    openFullDiskAccess(): Promise<void>;
  };
  browser?: DesktopBrowser;
  macControl?: DesktopMacControl;
  onOpenChat(callback: (id: string, runId: string | null) => void): Unsubscribe;
  onOpenSettings?(callback: (target: IslandSettingsTarget) => void): Unsubscribe;
}

export function sparkDesktop(): SparkDesktop | null {
  if (typeof window === 'undefined') return null;
  return (window as { sparkDesktop?: SparkDesktop }).sparkDesktop ?? null;
}

export function afterPaint(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

export function desktopBrowser(): DesktopBrowser | null {
  return sparkDesktop()?.browser ?? null;
}

export function desktopMacControl(): DesktopMacControl | null {
  return sparkDesktop()?.macControl ?? null;
}

export function companionAvailable(): boolean {
  return sparkDesktop()?.platform === 'darwin';
}
