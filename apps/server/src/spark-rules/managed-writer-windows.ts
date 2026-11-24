import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { promisify } from 'node:util';
import { rulesTextHash } from './accepted.ts';
import { RulesFileError } from './rules-file.ts';
import { readRulesFile, StaleRulesError, type ManagedWrite } from './rules-store.ts';

const run = promisify(execFile);

export const STALE_EXIT = 3;
export const CHANGED_EXIT = 4;
export const CANCELLED_EXIT = 1223;

export const CANCELLED_UAC =
  'You cancelled the Windows administrator prompt, so the company rules did not change.';
export const CHANGED_STAGED_WINDOWS =
  'The staged company rules changed before Windows wrote them, so Spark changed nothing.';
export const NOT_WRITTEN_WINDOWS =
  'Windows reported the change, but the company rules file does not hold it, so Spark changed nothing.';

const FOLDER_SDDL = 'O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)';
const FILE_SDDL = 'O:BAG:SYD:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FRFX;;;BU)';

export interface WindowsInstall {
  source: string;
  target: string;
  staged: string;
  textHash: string;
  previousHash: string;
}

export type ElevatedRunner = (powershell: string, args: readonly string[]) => Promise<void>;

export function systemPowershell(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot?.trim() || env.SYSTEMROOT?.trim() || 'C:\\Windows';
  return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export function powershellLiteral(text: string): string {
  return `'${text.replace(/['\u2018\u2019\u201A\u201B]/g, (mark) => mark + mark)}'`;
}

export function encodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function stagedPathFor(target: string): string {
  return win32.join(win32.dirname(target), `.managed-settings.${randomUUID()}.tmp`);
}

export function windowsInstallScript(install: WindowsInstall): string {
  const folder = win32.dirname(install.target);
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$source = ${powershellLiteral(install.source)}`,
    `$target = ${powershellLiteral(install.target)}`,
    `$staged = ${powershellLiteral(install.staged)}`,
    `$folder = ${powershellLiteral(folder)}`,
    `$want = ${powershellLiteral(install.textHash)}`,
    `$was = ${powershellLiteral(install.previousHash)}`,
    'function Digest($file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }',
    'try {',
    `  if ($was -eq 'missing') { if (Test-Path -LiteralPath $target) { exit ${STALE_EXIT} } }`,
    `  elseif (-not (Test-Path -LiteralPath $target -PathType Leaf) -or (Digest $target) -ne $was) { exit ${STALE_EXIT} }`,
    '  [void][IO.Directory]::CreateDirectory($folder)',
    '  $folderAcl = New-Object Security.AccessControl.DirectorySecurity',
    `  $folderAcl.SetSecurityDescriptorSddlForm('${FOLDER_SDDL}')`,
    '  Set-Acl -LiteralPath $folder -AclObject $folderAcl',
    '  [IO.File]::Copy($source, $staged, $true)',
    `  if ((Digest $staged) -ne $want) { [IO.File]::Delete($staged); exit ${CHANGED_EXIT} }`,
    '  if ([IO.File]::Exists($target)) { [IO.File]::Replace($staged, $target, [NullString]::Value) }',
    '  else { [IO.File]::Move($staged, $target) }',
    '  $fileAcl = New-Object Security.AccessControl.FileSecurity',
    `  $fileAcl.SetSecurityDescriptorSddlForm('${FILE_SDDL}')`,
    '  Set-Acl -LiteralPath $target -AclObject $fileAcl',
    '  exit 0',
    '} catch {',
    '  if ([IO.File]::Exists($staged)) { [IO.File]::Delete($staged) }',
    '  exit 5',
    '}',
  ].join('\n');
}

export function elevationScript(powershell: string, inner: string): string {
  const argumentList = `-NoProfile -NonInteractive -EncodedCommand ${encodedCommand(inner)}`;
  return [
    `$ErrorActionPreference = 'Stop'`,
    'try {',
    `  $process = Start-Process -FilePath ${powershellLiteral(powershell)} -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList ${powershellLiteral(argumentList)}`,
    '} catch {',
    '  $problem = $_.Exception',
    '  while ($problem) {',
    `    if ($problem -is [ComponentModel.Win32Exception] -and $problem.NativeErrorCode -eq ${CANCELLED_EXIT}) { exit ${CANCELLED_EXIT} }`,
    '    $problem = $problem.InnerException',
    '  }',
    '  exit 1',
    '}',
    'exit $process.ExitCode',
  ].join('\n');
}

export function elevationArgs(powershell: string, install: WindowsInstall): string[] {
  const outer = elevationScript(powershell, windowsInstallScript(install));
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(outer)];
}

export const runElevated: ElevatedRunner = async (powershell, args) => {
  await run(powershell, [...args], { windowsHide: true, timeout: 10 * 60_000 });
};

function exitCodeOf(error: unknown): number | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'number' ? code : null;
}

function elevationError(error: unknown, staleMessage: string): Error {
  const code = exitCodeOf(error);
  if (code === CANCELLED_EXIT) return new RulesFileError(CANCELLED_UAC);
  if (code === STALE_EXIT) return new StaleRulesError(staleMessage);
  if (code === CHANGED_EXIT) return new RulesFileError(CHANGED_STAGED_WINDOWS);
  return error instanceof Error ? error : new Error(String(error));
}

export function windowsManagedWrite(
  staleMessage: string,
  runner: ElevatedRunner = runElevated,
  env: NodeJS.ProcessEnv = process.env,
): ManagedWrite {
  return async (target, text, previousHash) => {
    const folder = await mkdtemp(join(tmpdir(), 'spark-managed-'));
    const source = join(folder, 'managed-settings.json');
    const textHash = rulesTextHash({ kind: 'text', text });
    const powershell = systemPowershell(env);
    const install = { source, target, staged: stagedPathFor(target), textHash, previousHash };
    try {
      await writeFile(source, text, { mode: 0o600 });
      await runner(powershell, elevationArgs(powershell, install));
    } catch (error) {
      throw elevationError(error, staleMessage);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
    if (rulesTextHash(await readRulesFile(target)) !== textHash) {
      throw new RulesFileError(NOT_WRITTEN_WINDOWS);
    }
  };
}
