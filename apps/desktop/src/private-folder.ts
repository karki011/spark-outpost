import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type RunFile = (file: string, args: readonly string[]) => string;

const PRIVATE_SDDL = 'D:PAI(A;OICI;FA;;;$sid)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)';

const runFile: RunFile = (file, args) =>
  execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });

function powershell(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot ?? 'C:\\Windows';
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function quoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

export function privateFolderScript(folder: string): string {
  const target = quoted(folder);
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value`,
    `$acl = Get-Acl -LiteralPath ${target}`,
    `$acl.SetSecurityDescriptorSddlForm("${PRIVATE_SDDL}", 'Access')`,
    `Set-Acl -LiteralPath ${target} -AclObject $acl`,
  ].join('; ');
}

export function makeFolderPrivate(
  folder: string,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; run?: RunFile } = {},
): void {
  if ((options.platform ?? process.platform) !== 'win32') return;
  const run = options.run ?? runFile;
  const args = ['-NoProfile', '-NonInteractive', '-Command', privateFolderScript(folder)];
  run(powershell(options.env ?? process.env), args);
}

export function makeDataFolderPrivate(folder: string, log: (line: string) => void): void {
  if (process.platform !== 'win32') return;
  try {
    mkdirSync(folder, { recursive: true });
    makeFolderPrivate(folder);
  } catch (error) {
    log(`Could not make the data folder private: ${(error as Error).message}`);
  }
}
