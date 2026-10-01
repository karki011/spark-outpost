import type {
  DesktopHelpInfo,
  DiagnosticsExport,
  InstallResult,
  UpdateChannel,
  UpdateStatus,
} from '@spark-outpost/contracts';

export type IslandAction = 'quick' | 'sessions';

export interface CompanionStatus {
  supported: boolean;
  enabled: boolean;
  calm: boolean;
  shortcuts: Record<IslandAction, string>;
  failed: IslandAction[];
}

export type ShortcutResult = { ok: true } | { ok: false; error: string };

export interface IslandGeometry {
  notch: boolean;
  top: number;
  notchWidth: number;
  docked: boolean;
}

type Unsubscribe = () => void;

export interface SparkDesktop {
  platform: string;
  companion: {
    get(): Promise<CompanionStatus | null>;
    setEnabled(on: boolean): Promise<CompanionStatus>;
    setCalm(on: boolean): Promise<CompanionStatus>;
    setShortcut(action: IslandAction, accelerator: string | null): Promise<ShortcutResult>;
    onChange(callback: (status: CompanionStatus) => void): Unsubscribe;
  };
  island: {
    geometry(): Promise<IslandGeometry | null>;
    onGeometry(callback: (geometry: IslandGeometry) => void): Unsubscribe;
    onCommand(callback: (action: IslandAction) => void): Unsubscribe;
    setInteractive(on: boolean): void;
    setFocusable(on: boolean): void;
    drag(phase: 'start' | 'move' | 'end', x: number, y: number): void;
    openChat(id: string | null): void;
  };
  updates: {
    get(): Promise<UpdateStatus | null>;
    check(): Promise<UpdateStatus | null>;
    setChannel(channel: UpdateChannel): Promise<UpdateStatus | null>;
    setAutoDownload(on: boolean): Promise<UpdateStatus | null>;
    install(): Promise<InstallResult>;
    onChange(callback: (status: UpdateStatus) => void): Unsubscribe;
  };
  help?: {
    info(): Promise<DesktopHelpInfo | null>;
    exportDiagnostics(): Promise<DiagnosticsExport | null>;
    showLogs(): Promise<void>;
    onOpenFeedback(callback: () => void): Unsubscribe;
  };
  onOpenChat(callback: (id: string) => void): Unsubscribe;
}

export function sparkDesktop(): SparkDesktop | null {
  if (typeof window === 'undefined') return null;
  return (window as { sparkDesktop?: SparkDesktop }).sparkDesktop ?? null;
}

export function companionAvailable(): boolean {
  return sparkDesktop()?.platform === 'darwin';
}
