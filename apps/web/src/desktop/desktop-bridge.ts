import type {
  BrowserCommand,
  BrowserPaneState,
  BrowserPick,
  BrowserPlacement,
  DesktopHelpInfo,
  DiagnosticsExport,
  InstallResult,
  SignedInSite,
  UpdateChannel,
  UpdateStatus,
} from '@spark-outpost/contracts';

export type IslandAction = 'quick' | 'sessions';

export type IslandSettingsTarget =
  'island' | 'sparks' | 'spark-new' | 'connectors' | `spark-edit:${string}`;

export type IslandSize = 'small' | 'medium' | 'large';

export interface CompanionStatus {
  supported: boolean;
  enabled: boolean;
  shortcuts: Record<IslandAction, string>;
  failed: IslandAction[];
  sound?: boolean;
  islandSize?: IslandSize;
}

export type ShortcutResult = { ok: true } | { ok: false; error: string };

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  docked: boolean;
  menuBar: number;
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
  sites(projectId: string): Promise<SignedInSite[] | null>;
  signOut(projectId: string, origin: string | null): Promise<SignedInSite[] | null>;
  onState(callback: (state: BrowserPaneState) => void): Unsubscribe;
  onSnapshot(callback: (snapshot: BrowserSnapshot) => void): Unsubscribe;
  onPicked(callback: (pick: BrowserPick) => void): Unsubscribe;
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
    onChange(callback: (status: CompanionStatus) => void): Unsubscribe;
  };
  island: {
    geometry(): Promise<IslandGeometry | null>;
    onGeometry(callback: (geometry: IslandGeometry) => void): Unsubscribe;
    onCommand(callback: (action: IslandAction) => void): Unsubscribe;
    onEscape(callback: () => void): Unsubscribe;
    sparkFocused(): Promise<boolean>;
    pickFolder(): Promise<string | null>;
    pathForFile(file: File): string | null;
    onSparkFocus(callback: (focused: boolean) => void): Unsubscribe;
    setInteractive(on: boolean): void;
    setFocusable(on: boolean): void;
    drag(phase: 'start' | 'move' | 'end', x: number, y: number): void;
    openChat(id: string | null): void;
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
  onOpenChat(callback: (id: string) => void): Unsubscribe;
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

export function companionAvailable(): boolean {
  return sparkDesktop()?.platform === 'darwin';
}
