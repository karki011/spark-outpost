import { describe, expect, it } from 'vitest';
import { powershellScript } from './powershell-command.ts';
import { readCodexCommand, readPowerShell } from './powershell-read.ts';
import type { ApprovalRequest } from './decide.ts';

const UTF8 = 'try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}';
const SHLEX_EXE = `"C:"'\\'"WINDOWS"'\\'"System32"'\\'"WindowsPowerShell"'\\'"v1.0"'\\'"powershell.exe"`;

describe('the script Codex asks to run in PowerShell', () => {
  it.each([
    ['a bare script', 'git status', 'git status'],
    ['a shell-quoted script', `"git push origin main"`, 'git push origin main'],
    ['the full command, shell-quoted', `${SHLEX_EXE} -NoProfile -c 'git status'`, 'git status'],
    ['pwsh with -Command', `pwsh -NoLogo -Command "git status"`, 'git status'],
    ['a plain path', 'C:\\Program\\pwsh.exe -c git status', 'git status'],
    ['the policy flag', 'powershell -ExecutionPolicy Bypass -c "git status"', 'git status'],
    ['the encoding line', `pwsh -NoProfile -c "${UTF8}\ngit status"`, 'git status'],
    ['a backslash in single quotes', `pwsh -c 'Get-Content C:\\a.txt'`, 'Get-Content C:\\a.txt'],
  ])('reads %s', (_name, command, script) => {
    expect(powershellScript(command)?.trim()).toBe(script);
  });

  it.each([
    ['an encoded command', 'powershell -EncodedCommand ZwBpAHQA'],
    ['a script file', 'pwsh -File build.ps1'],
    ['an unknown flag', 'pwsh -Nop -c "git status"'],
    ['no command flag', 'pwsh "git status"'],
    ['a backslash in double quotes', 'pwsh -c "Remove-Item C:\\Users\\me"'],
    ['a variable in double quotes', 'pwsh -c "echo $x"'],
    ['quotes among several words', `pwsh -c Set-Content 'a b.txt' x`],
  ])('fails closed on %s', (_name, command) => {
    expect(powershellScript(command)).toBeNull();
  });
});

describe('reading a PowerShell command as bash', () => {
  it.each([
    ['git push --force origin main', 'git push --force origin main'],
    ['git.exe status', 'git status'],
    ["& 'git' status", 'git status'],
    ['Get-Content src\\a.ts', 'cat -- src/a.ts'],
    ['gc -Path:C:\\work\\a.ts', 'cat -- /c/work/a.ts'],
    ['Set-Content -Path ..\\x.txt -Value hi', 'echo > ../x.txt'],
    ['Write-Output hi | Set-Content x.txt', 'echo hi | cat > x.txt'],
    ['Remove-Item -Recurse -Force build', 'rm -r -f -- build'],
    ['Remove-Item -Recurse:$false build', 'rm -f -- build'],
    ['Copy-Item a.txt -Destination C:\\out', 'cp -- a.txt /c/out'],
    ['mv a.txt b.txt', 'mv -f -- a.txt b.txt'],
    ['Rename-Item src\\a.txt b.txt', 'mv -- src/a.txt src/b.txt'],
    ['New-Item -ItemType Directory -Path x\\y -Force', 'mkdir -p -- x/y'],
    ['New-Item -Path src -Name a.ts', 'echo > src/a.ts'],
    ['mkdir out', 'mkdir -p -- out'],
    ['ls src\\*.ts', 'ls -- src/*.ts'],
    ['Remove-Item src\\*.tmp', 'rm -f -- src/*.tmp'],
    [
      'git status 2> $null; git diff > out.txt 2>&1',
      'git status 2> /dev/null; git diff > out.txt 2>&1',
    ],
    ['echo hi *> log.txt', 'echo hi > log.txt 2>&1'],
    [
      'git add . && git commit -m "Fix it" || echo failed',
      "git add . && git commit -m 'Fix it' || echo failed",
    ],
    ['Get-ChildItem | Sort-Object Name | Select-Object -First 3', 'ls | cat | cat'],
    ['git push origin HEAD # done', 'git push origin HEAD'],
  ])('reads %s', async (command, bash) => {
    expect(await readPowerShell(command)).toBe(bash);
  });

  it.each([
    ['a subexpression', 'git commit -m "$(Get-Date)"'],
    ['a variable', 'Remove-Item $path'],
    ['a variable as the command', '& $git push'],
    ['Invoke-Expression', 'Invoke-Expression "git push"'],
    ['iex', 'iex "git push"'],
    ['an encoded command', 'powershell -EncodedCommand ZwBpAHQA'],
    ['a nested shell', 'cmd /c del .env'],
    ['a script block', 'Get-ChildItem | Where-Object { $_.Length -gt 1 }'],
    ['ForEach-Object', 'Get-ChildItem | ForEach-Object { Remove-Item $_ }'],
    ['an unknown cmdlet', 'Invoke-WebRequest https://example.com -OutFile a.txt'],
    ['an unmapped alias', 'iwr https://example.com'],
    ['curl, an alias in Windows PowerShell', 'curl https://example.com'],
    ['an unknown program', 'deploy-tool --prod'],
    ['a script', '.\\build.ps1'],
    ['a program path', 'C:\\tools\\git.exe push'],
    ['a pipe into an unknown cmdlet', 'Get-Content .env | Send-MailMessage'],
    ['a redirect to a variable', 'echo hi > $target'],
    ['a stream other than output and errors', 'echo hi 3> log.txt'],
    ['an array', 'Remove-Item a,b'],
    ['an abbreviated parameter', 'Remove-Item -Rec build'],
    ['an unknown parameter', 'Remove-Item -Stream x build'],
    ['a path from the pipeline', 'Get-ChildItem | Remove-Item'],
    ['a symbolic link', 'New-Item -ItemType SymbolicLink -Path a -Value b'],
    ['a stop-parsing token', 'git --% push'],
    ['a backtick', 'echo a`nb'],
    ['splatting', 'git @args'],
    ['a typographic dash', 'Remove-Item \u2013Recurse x'],
    ['an assignment', '$x = 1; git push'],
    ['an if statement', 'if ($true) { git push }'],
    ['a dot-sourced script', '. .\\profile.ps1'],
    ['a parse error', 'git log -1 --format=%H'],
    ['a value glued to an argument', 'git status 2>$null'],
    ['a registry path', 'Remove-Item -Recurse HKCU:\\Software\\x'],
    ['a provider drive as the folder', 'Set-Location HKLM:'],
    ['the environment drive', 'Set-Content Env:\\X y'],
    ['a drive-relative path', 'Remove-Item C:x'],
    ['an alternate data stream', 'Set-Content a.txt:s x'],
    ['a provider-qualified path', 'Remove-Item FileSystem::C:\\x'],
    ['a long path prefix', 'Remove-Item \\\\?\\C:\\x'],
    ['an unknown program with .exe', 'robocopy.exe C:\\work\\app\\.env C:\\Users\\me'],
    ['certutil', 'certutil.exe -urlcache -f https://example.com a.exe'],
  ])('fails closed on %s', async (_name, command) => {
    expect(await readPowerShell(command)).toBeNull();
  });

  it('reads only Codex commands on Windows', async () => {
    const request = { kind: 'execute', command: 'Remove-Item $x' } as ApprovalRequest;
    expect(await readCodexCommand(request, false)).toEqual({ readAs: null, unreadable: false });
    expect(await readCodexCommand(request, true)).toEqual({ readAs: null, unreadable: true });
    const read = await readCodexCommand({ ...request, command: 'git status' }, true);
    expect(read).toEqual({ readAs: 'git status', unreadable: false });
  });
});
