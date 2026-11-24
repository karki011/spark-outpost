import { describe, expect, it } from 'vitest';
import { powershellScript } from './powershell-command.ts';
import { readCodexCommand, readPowerShell } from './powershell-read.ts';
import type { ApprovalRequest } from './decide.ts';

const UTF8 = 'try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}';
const SHLEX_EXE = `"C:"'\\'"WINDOWS"'\\'"System32"'\\'"WindowsPowerShell"'\\'"v1.0"'\\'"powershell.exe"`;

function wrap(script: string): string {
  return `pwsh -NoProfile -c '${script.replaceAll("'", `'"'"'`)}'`;
}

describe('the script Codex asks to run in PowerShell', () => {
  it.each([
    ['a quoted full command', `"pwsh -c 'git push origin main'"`, 'git push origin main'],
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
    ['a bare script', 'git status'],
    ['a shell-quoted script', `"git push origin main"`],
    ['a bash script with an escape', 'git p\\ush origin main'],
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
    ['Remove-Item -LiteralPath src\\[a].tmp', "rm -f -- 'src/[a].tmp'"],
    ['git log > out.txt', 'git log > out.txt'],
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
    expect(await readPowerShell(wrap(command))).toBe(bash);
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
    ['NEL between words', 'git push\u0085--force origin spark/fix-1'],
    ['NEL in git config', 'git config\u0085core.hooksPath x'],
    ['NEL in a path', 'Set-Content .git\\hooks\\pre-commit\u0085x'],
    ['a file separator control', 'git push\u001c--force origin main'],
    ['a non-breaking space', 'git push\u00a0--force origin main'],
    ['non-ASCII outside quotes', 'git push origin spark/fix\u00e9'],
    ['NEL inside quotes', "git commit -m 'a\u0085b'"],
    ['an empty native argument', "git '' push --force origin main"],
    [
      'a double quote in a native argument',
      `git push origin spark/fix-1 '--push-option=a b" main "--push-option=c'`,
    ],
    ['a spaced native argument ending in a backslash', "git commit -m 'a b\\'"],
    ['a trailing dot in a path part', 'Get-Content C:\\Users\\me\\AppData\\Spark.\\Cookies'],
    ['a trailing dot on a file', 'Set-Content AGENTS.md. x'],
    ['a trailing space on a file', "Set-Content 'AGENTS.md ' x"],
    ['a trailing dot on .git', 'Set-Content .git.\\hooks\\pre-commit x'],
    ['a short name', 'Set-Content AGENTS~1.MD x'],
    ['a short name as the new name', 'Rename-Item a.txt AGENTS~1.MD'],
    ['a wildcard delete', "Remove-Item '.e*'"],
    ['a bracket wildcard write', "Set-Content '[.]env' x"],
    ['a question mark write', "Set-Content 'AGENTS.m?' x"],
    ['a wildcard redirect', "echo x > 'AGENTS.m?'"],
    ['a wildcard in a folder', 'Remove-Item -Recurse .git\\hoo*'],
    ['a wildcard read', 'Get-ChildItem src\\*.ts'],
    ['a wildcard destination', 'Copy-Item a.txt AGENTS.m?'],
    ['a wildcard Out-File target', "Write-Output x | Out-File 'AGENTS.m?'"],
    ['an unquoted /dev/null redirect', 'git status > /dev/null'],
    ['a rooted path on the current drive', 'Set-Content \\dev\\null x'],
    ['certutil', 'certutil.exe -urlcache -f https://example.com a.exe'],
  ])('fails closed on %s', async (_name, command) => {
    expect(await readPowerShell(wrap(command))).toBeNull();
  });

  it.each(['git p\\ush origin main', 'echo x > AGENTS.m\\d', 'git status'])(
    'never reads a script Codex sent without PowerShell: %s',
    async (command) => {
      expect(await readPowerShell(command)).toBeNull();
    },
  );

  it('reads only Codex commands on Windows, as Codex sent them', async () => {
    const request = { kind: 'execute', command: 'Remove-Item $x' } as ApprovalRequest;
    expect(await readCodexCommand(request, false)).toEqual({
      request,
      readAs: null,
      unreadable: false,
    });
    expect(await readCodexCommand(request, true)).toMatchObject({ readAs: null, unreadable: true });
    const read = await readCodexCommand({ ...request, command: wrap('git status') }, true);
    expect(read).toMatchObject({ readAs: 'git status', unreadable: false });
    const mangled = {
      ...request,
      command: 'Remove-Item C:Usersme',
      sentCommand: wrap('Remove-Item C:\\Users\\me$x'),
    };
    const raw = await readCodexCommand(mangled, true);
    expect(raw.request.command).toBe(mangled.sentCommand);
    expect(raw.unreadable).toBe(true);
    const titled = { ...request, command: wrap('git status'), sentCommand: null };
    expect(await readCodexCommand(titled, true)).toMatchObject({ readAs: null, unreadable: true });
  });
});
