import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { loginShellSpawner } from './pty.ts';
import {
  cliDeps,
  cliRun,
  cmdLine,
  findOnPath,
  shimTarget,
  windowsCliRun,
  type CliDeps,
} from './windows-cli.ts';

const exec = promisify(execFile);

const NPM_JS_SHIM =
  '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';

const NPM_EXE_SHIM =
  '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';

const NPM = 'C:\\Users\\me\\AppData\\Roaming\\npm';
const CODEX_JS = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
const CLAUDE_EXE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

function fakeDeps(files: Record<string, string>, pathValue: string): CliDeps {
  return {
    env: { Path: pathValue, SystemRoot: 'C:\\Windows' },
    exists: (file) => Object.hasOwn(files, file),
    read: (file) => files[file] ?? null,
  };
}

describe('finding a CLI on the Windows PATH', () => {
  it('prefers a real .exe anywhere on the PATH over an npm .cmd shim earlier on it', () => {
    const deps = fakeDeps(
      { [`${NPM}\\claude.cmd`]: NPM_EXE_SHIM, 'C:\\Users\\me\\.local\\bin\\claude.exe': '' },
      `${NPM};"C:\\Users\\me\\.local\\bin";`,
    );
    expect(findOnPath('claude', deps)).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
  });

  it('falls back to the .cmd shim and finds nothing when the CLI is missing', () => {
    const deps = fakeDeps({ [`${NPM}\\codex.cmd`]: NPM_JS_SHIM }, `C:\\Windows;${NPM}`);
    expect(findOnPath('codex', deps)).toBe(`${NPM}\\codex.cmd`);
    expect(findOnPath('claude', deps)).toBeNull();
  });
});

describe('reading an npm shim', () => {
  it('finds the script and the executable an npm shim runs', () => {
    expect(shimTarget(NPM_JS_SHIM, `${NPM}\\codex.cmd`)).toBe(CODEX_JS);
    expect(shimTarget(NPM_EXE_SHIM, `${NPM}\\claude.cmd`)).toBe(CLAUDE_EXE);
    expect(shimTarget('@echo off\r\nexit /b 1\r\n', `${NPM}\\x.cmd`)).toBeNull();
  });
});

describe('running a CLI on Windows', () => {
  it('runs the script of a JavaScript shim with Node from the PATH, multi-line arguments included', () => {
    const deps = fakeDeps(
      { [`${NPM}\\codex.cmd`]: NPM_JS_SHIM, [CODEX_JS]: '', [NODE]: '' },
      `C:\\Program Files\\nodejs;${NPM}`,
    );
    expect(windowsCliRun(`${NPM}\\codex.cmd`, ['--', 'line one\nline two'], deps)).toEqual({
      file: NODE,
      args: [CODEX_JS, '--', 'line one\nline two'],
      verbatim: false,
    });
  });

  it('prefers the node.exe beside the shim, as the shim does', () => {
    const beside = `${NPM}\\node.exe`;
    const deps = fakeDeps(
      { [`${NPM}\\codex.cmd`]: NPM_JS_SHIM, [CODEX_JS]: '', [NODE]: '', [beside]: '' },
      `C:\\Program Files\\nodejs;${NPM}`,
    );
    expect(windowsCliRun(`${NPM}\\codex.cmd`, [], deps).file).toBe(beside);
  });

  it('runs the executable an npm shim points to directly', () => {
    const deps = fakeDeps({ [`${NPM}\\claude.cmd`]: NPM_EXE_SHIM, [CLAUDE_EXE]: '' }, NPM);
    expect(windowsCliRun(`${NPM}\\claude.cmd`, ['--version'], deps)).toEqual({
      file: CLAUDE_EXE,
      args: ['--version'],
      verbatim: false,
    });
  });

  it('leaves an .exe as it is, and every command as it is off Windows', () => {
    const deps = fakeDeps({}, '');
    expect(windowsCliRun('C:\\bin\\claude.exe', ['a'], deps)).toEqual({
      file: 'C:\\bin\\claude.exe',
      args: ['a'],
      verbatim: false,
    });
    expect(cliRun('/usr/local/bin/claude.cmd', ['a'], 'darwin', deps)).toEqual({
      file: '/usr/local/bin/claude.cmd',
      args: ['a'],
      verbatim: false,
    });
  });

  it('runs any other batch file through cmd.exe with its line quoted for cmd', () => {
    const deps = fakeDeps({ 'C:\\tools\\my cli.cmd': '@echo off\r\nrun.exe %*\r\n' }, '');
    expect(windowsCliRun('C:\\tools\\my cli.cmd', ['a b', 'say "hi"'], deps)).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\tools\\my^ cli.cmd ^^^"a^^^ b^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^""',
      ],
      verbatim: true,
    });
  });

  it('refuses a multi-line argument that would have to pass through cmd.exe', () => {
    expect(() => cmdLine('C:\\tools\\x.cmd', ['one\ntwo'])).toThrow('multi-line argument');
  });
});

describe.skipIf(process.platform !== 'win32')('npm shims on a real Windows PC', () => {
  let folder: string;
  const PRINT = 'process.stdout.write("argv:" + JSON.stringify(process.argv.slice(2)) + "\\n")';
  const ARGS = ['plain', 'with space', 'say "hi"', '50% & more', 'a\\b\\'];

  const makeShims = () => {
    folder = mkdtempSync(path.join(tmpdir(), 'spark shim-'));
    const script = path.join(folder, 'node_modules', 'demo', 'cli.js');
    mkdirSync(path.dirname(script), { recursive: true });
    writeFileSync(script, PRINT);
    writeFileSync(
      path.join(folder, 'demo.cmd'),
      NPM_JS_SHIM.replace('@openai\\codex\\bin\\codex.js', 'demo\\cli.js'),
    );
    writeFileSync(
      path.join(folder, 'other.cmd'),
      `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
    );
  };

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('passes every argument through an npm shim and through cmd.exe unchanged', async () => {
    makeShims();
    const deps = cliDeps(process.env);
    const viaShim = cliRun(path.join(folder, 'demo.cmd'), [...ARGS, 'one\ntwo'], 'win32', deps);
    expect(viaShim.verbatim).toBe(false);
    const shimmed = await exec(viaShim.file, viaShim.args, { encoding: 'utf8' });
    expect(shimmed.stdout).toContain(`argv:${JSON.stringify([...ARGS, 'one\ntwo'])}`);
    const viaCmd = cliRun(path.join(folder, 'other.cmd'), ARGS, 'win32', deps);
    expect(viaCmd.verbatim).toBe(true);
    const batch = await exec(viaCmd.file, viaCmd.args, {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    });
    expect(batch.stdout).toContain(`argv:${JSON.stringify(ARGS)}`);
  });

  it('starts an npm shim in a ConPTY', async () => {
    makeShims();
    const pty = loginShellSpawner()({
      cols: 200,
      rows: 24,
      cwd: folder,
      command: path.join(folder, 'demo.cmd'),
      args: ['in a pty'],
    });
    let output = '';
    pty.onData((data) => {
      output += data;
    });
    await new Promise<void>((resolve) => pty.onExit(() => resolve()));
    expect(output.replace(/\s+/g, '')).toContain('argv:["inapty"]');
  });
});
