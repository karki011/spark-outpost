import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { win32 } from 'node:path';
import { promisify } from 'node:util';
import { powershellLiteral, systemPowershell } from './managed-writer-windows.ts';

const run = promisify(execFile);

const ADMINISTRATORS = 'S-1-5-32-544';
const SYSTEM = 'S-1-5-18';
const TRUSTED_INSTALLER = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464';
const TRUSTED = new Set([ADMINISTRATORS, SYSTEM, TRUSTED_INSTALLER]);

const DELETE = 0x10000;
const WRITE_DAC = 0x40000;
const WRITE_OWNER = 0x80000;
const GENERIC_ALL = 0x10000000;
const GENERIC_WRITE = 0x40000000;
const CONTROL = DELETE | WRITE_DAC | WRITE_OWNER | GENERIC_ALL | GENERIC_WRITE;
const FILE_WRITES = 0x2 | 0x4 | CONTROL;
const FOLDER_WRITES = 0x40 | CONTROL;

export type AclTarget = 'file' | 'folder';

export interface AclLine {
  target: AclTarget;
  kind: 'owner' | 'allow' | 'deny';
  sid: string;
  name: string;
  rights: number;
  inheritOnly: boolean;
}

export function aclScript(file: string): string {
  const emit = (target: AclTarget, path: string) => [
    `$acl = Get-Acl -LiteralPath ${powershellLiteral(path)}`,
    `$owner = $acl.GetOwner([Security.Principal.SecurityIdentifier])`,
    `"${target}|owner|$($owner.Value)|0|0|$(Name $owner)"`,
    `foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {`,
    `  $only = [int](($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0)`,
    `  "${target}|$($rule.AccessControlType.ToString().ToLowerInvariant())|$($rule.IdentityReference.Value)|$($rule.FileSystemRights.value__)|$only|$(Name $rule.IdentityReference)"`,
    `}`,
  ];
  return [
    `$ErrorActionPreference = 'Stop'`,
    `function Name($sid) { try { $sid.Translate([Security.Principal.NTAccount]).Value } catch { $sid.Value } }`,
    ...emit('file', file),
    ...emit('folder', win32.dirname(file)),
  ].join('\n');
}

export function parseAclLines(output: string): AclLine[] {
  return output.split(/\r?\n/).flatMap((line) => {
    const [target, kind, sid, rights, inheritOnly, ...name] = line.trim().split('|');
    if (target !== 'file' && target !== 'folder') return [];
    if (kind !== 'owner' && kind !== 'allow' && kind !== 'deny') return [];
    if (!sid || rights === undefined || !/^-?\d+$/.test(rights)) return [];
    const label = name.join('|') || sid;
    return [
      {
        target,
        kind,
        sid,
        name: label,
        rights: Number(rights) >>> 0,
        inheritOnly: inheritOnly === '1',
      },
    ];
  });
}

function writes(line: AclLine): boolean {
  const mask = line.target === 'file' ? FILE_WRITES : FOLDER_WRITES;
  return line.kind === 'allow' && !line.inheritOnly && (line.rights & mask) !== 0;
}

export function looseWriters(lines: readonly AclLine[]): string[] {
  const loose = lines.filter(
    (line) => !TRUSTED.has(line.sid) && (line.kind === 'owner' || writes(line)),
  );
  return [...new Set(loose.map((line) => line.name))];
}

export function looseAclProblem(name: string, writers: readonly string[]): string | null {
  if (writers.length === 0) return null;
  return `Accounts that aren't administrators can change ${name} (${writers.join(', ')}), so these rules don't bind them. Let Spark change the company rules once, or have an administrator remove that access`;
}

export type AclReader = (file: string) => Promise<string>;

const readAcl: AclReader = async (file) => {
  const powershell = systemPowershell();
  const args = ['-NoProfile', '-NonInteractive', '-Command', aclScript(file)];
  const { stdout } = await run(powershell, args, { windowsHide: true, timeout: 30_000 });
  return stdout;
};

const checked = new Map<string, string | null>();

async function changeKey(file: string): Promise<string | null> {
  try {
    const [found, folder] = await Promise.all([stat(file), stat(win32.dirname(file))]);
    return `${file}|${found.ctimeMs}|${found.mtimeMs}|${folder.ctimeMs}`;
  } catch {
    return null;
  }
}

export async function managedAclProblem(
  file: string,
  read: AclReader = readAcl,
): Promise<string | null> {
  const key = await changeKey(file);
  if (key === null) return null;
  if (checked.has(key)) return checked.get(key) ?? null;
  let problem: string | null;
  try {
    problem = looseAclProblem(win32.basename(file), looseWriters(parseAclLines(await read(file))));
  } catch {
    return null;
  }
  checked.set(key, problem);
  return problem;
}
