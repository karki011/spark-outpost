export interface CmdletSpec {
  name: string;
  positional: readonly string[];
  values: readonly string[];
  switches: readonly string[];
  aliases?: Readonly<Record<string, string>>;
}

const COMMON_VALUES = ['erroraction', 'warningaction', 'informationaction'];
const COMMON_SWITCHES = ['verbose', 'debug', 'whatif', 'confirm'];
const PATH_ALIASES = { lp: 'literalpath', pspath: 'literalpath' };

function spec(
  name: string,
  positional: readonly string[],
  values: readonly string[],
  switches: readonly string[],
  aliases: Readonly<Record<string, string>> = {},
): CmdletSpec {
  return {
    name,
    positional,
    values: [...positional, ...values, ...COMMON_VALUES],
    switches: [...switches, ...COMMON_SWITCHES],
    aliases,
  };
}

const ITEM_FILTERS = ['filter', 'include', 'exclude'];

export const CMDLETS: readonly CmdletSpec[] = [
  spec(
    'Get-Content',
    ['path'],
    ['literalpath', 'tail', 'totalcount', 'encoding', 'readcount', 'delimiter', ...ITEM_FILTERS],
    ['raw', 'force'],
    { ...PATH_ALIASES, head: 'totalcount', first: 'totalcount', last: 'tail' },
  ),
  spec(
    'Set-Content',
    ['path', 'value'],
    ['literalpath', 'encoding'],
    ['nonewline', 'force', 'passthru'],
    PATH_ALIASES,
  ),
  spec(
    'Add-Content',
    ['path', 'value'],
    ['literalpath', 'encoding'],
    ['nonewline', 'force', 'passthru'],
    PATH_ALIASES,
  ),
  spec(
    'Out-File',
    ['filepath', 'encoding'],
    ['literalpath', 'width', 'inputobject'],
    ['append', 'force', 'noclobber', 'nonewline'],
    { path: 'filepath', ...PATH_ALIASES },
  ),
  spec('Tee-Object', ['filepath'], ['literalpath', 'inputobject', 'encoding'], ['append'], {
    path: 'filepath',
    ...PATH_ALIASES,
  }),
  spec('New-Item', ['path'], ['name', 'itemtype', 'value'], ['force'], { type: 'itemtype' }),
  spec('mkdir', ['path'], ['name', 'value'], ['force']),
  spec(
    'Remove-Item',
    ['path'],
    ['literalpath', ...ITEM_FILTERS],
    ['recurse', 'force'],
    PATH_ALIASES,
  ),
  spec(
    'Copy-Item',
    ['path', 'destination'],
    ['literalpath', ...ITEM_FILTERS],
    ['recurse', 'force', 'container', 'passthru'],
    PATH_ALIASES,
  ),
  spec(
    'Move-Item',
    ['path', 'destination'],
    ['literalpath', ...ITEM_FILTERS],
    ['force', 'passthru'],
    PATH_ALIASES,
  ),
  spec('Rename-Item', ['path', 'newname'], ['literalpath'], ['force', 'passthru'], PATH_ALIASES),
  spec(
    'Get-ChildItem',
    ['path', 'filter'],
    ['literalpath', 'include', 'exclude', 'depth'],
    ['recurse', 'force', 'name', 'file', 'directory', 'hidden'],
    PATH_ALIASES,
  ),
  spec(
    'Select-String',
    ['pattern', 'path'],
    ['literalpath', 'context', 'encoding', ...ITEM_FILTERS.slice(1)],
    ['simplematch', 'casesensitive', 'notmatch', 'list', 'quiet', 'allmatches', 'raw'],
  ),
  spec('Test-Path', ['path'], ['literalpath', 'pathtype'], ['isvalid'], PATH_ALIASES),
  spec('Set-Location', ['path'], ['literalpath'], [], PATH_ALIASES),
  spec('Push-Location', ['path'], ['literalpath'], [], PATH_ALIASES),
  spec('Get-Location', [], [], []),
  spec('Write-Output', [], [], ['noenumerate']),
  spec('Write-Host', [], ['foregroundcolor', 'backgroundcolor', 'separator'], ['nonewline']),
];

export const PIPE_FILTERS: ReadonlySet<string> = new Set(
  [
    'Select-Object',
    'Sort-Object',
    'Measure-Object',
    'Format-Table',
    'Format-List',
    'Out-String',
    'Out-Null',
    'Get-Unique',
    'ConvertTo-Json',
    'ConvertFrom-Json',
  ].map((name) => name.toLowerCase()),
);

const ALIASES: Readonly<Record<string, string>> = {
  sl: 'Set-Location',
  cd: 'Set-Location',
  chdir: 'Set-Location',
  cpi: 'Copy-Item',
  cp: 'Copy-Item',
  copy: 'Copy-Item',
  ri: 'Remove-Item',
  del: 'Remove-Item',
  erase: 'Remove-Item',
  rd: 'Remove-Item',
  rm: 'Remove-Item',
  rmdir: 'Remove-Item',
  gci: 'Get-ChildItem',
  dir: 'Get-ChildItem',
  ls: 'Get-ChildItem',
  write: 'Write-Output',
  echo: 'Write-Output',
  ni: 'New-Item',
  md: 'mkdir',
  mi: 'Move-Item',
  move: 'Move-Item',
  mv: 'Move-Item',
  gl: 'Get-Location',
  pwd: 'Get-Location',
  pushd: 'Push-Location',
  rni: 'Rename-Item',
  ren: 'Rename-Item',
  gc: 'Get-Content',
  cat: 'Get-Content',
  type: 'Get-Content',
  ac: 'Add-Content',
  tee: 'Tee-Object',
  sls: 'Select-String',
  select: 'Select-Object',
  sort: 'Sort-Object',
  measure: 'Measure-Object',
  ft: 'Format-Table',
  fl: 'Format-List',
};

const BY_NAME = new Map(CMDLETS.map((cmdlet) => [cmdlet.name.toLowerCase(), cmdlet]));

export function cmdletName(name: string): string {
  const lower = name.toLowerCase();
  return (ALIASES[lower] ?? name).toLowerCase();
}

export function cmdletSpec(name: string): CmdletSpec | null {
  return BY_NAME.get(cmdletName(name)) ?? null;
}

const NATIVE_TOOLS = new Set([
  'git',
  'gh',
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'deno',
  'python',
  'python3',
  'py',
  'pip',
  'pip3',
  'uv',
  'cargo',
  'rustc',
  'go',
  'dotnet',
  'make',
  'cmake',
  'rg',
  'tsc',
  'eslint',
  'prettier',
  'vitest',
  'jest',
  'java',
  'mvn',
  'gradle',
  'tar',
  'findstr',
]);

export function nativeName(name: string): string | null {
  const lower = name.toLowerCase();
  const bare = lower.endsWith('.exe') ? lower.slice(0, -4) : lower;
  return NATIVE_TOOLS.has(bare) ? bare : null;
}
