import type { TerminalServerMessage } from '@spark-outpost/contracts';
import type { OpenShell } from '../persistence/terminal-shells.ts';
import type { StartObserver } from './start-timing.ts';

export interface TerminalClient {
  output(data: string): void;
  send(message: TerminalServerMessage): void;
  close(): void;
}

export interface TerminalLimits {
  tokenTtlMs: number;
  idleMs: number;
  maxMs: number;
  maxSessions: number;
  maxShells: number;
  maxViews: number;
  quietMs: number;
  folderCheckMs: number;
}

export const defaultLimits: TerminalLimits = {
  tokenTtlMs: 60_000,
  idleMs: 10 * 60_000,
  maxMs: 30 * 60_000,
  maxSessions: 2,
  maxShells: 12,
  maxViews: 12,
  quietMs: 500,
  folderCheckMs: 3_000,
};

export interface AgentRequest extends ShellRequest {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  adopt?: boolean;
  observer?: StartObserver;
  onExit?: (exit: { exitCode: number; signal?: number | undefined }) => void;
}

export interface TerminalView {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  detach(): void;
}

export interface ViewedOutput {
  output(data: string): void;
  ended(): void;
}

export type OpenView = (
  viewer: ViewedOutput,
  size: { cols: number; rows: number },
) => TerminalView | null;

export interface ShellRequest {
  cwd: string;
  conversationId: string | null;
  label?: string | undefined;
}

export interface ShellWatcher {
  opened(shell: OpenShell): void;
  output?(id: string, data: string): void;
  ended(id: string): void;
}

export class TerminalLimitError extends Error {}
export class TerminalAuthError extends Error {}

export interface AttachedTerminal {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
  disconnect(): void;
}
