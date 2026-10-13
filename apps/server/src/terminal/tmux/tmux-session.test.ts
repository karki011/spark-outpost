import { describe, expect, it } from 'vitest';
import { hexWords, paneExit } from './control-pty.ts';
import { launchCommand, parsePane, sessionName } from './tmux-session.ts';

const start = {
  sessionId: '7f1e3b3a-0000-4000-8000-000000000001',
  cols: 120,
  rows: 40,
  cwd: "/work/it's here",
  command: '/usr/local/bin/claude',
  args: ['--append-system-prompt', "line one\nline 'two' #{pane_id} $(id)", '--', 'hi'],
  env: {
    PATH: '/usr/bin',
    SHELL: '/bin/zsh',
    SPARK_NATIVE_MCP_TOKEN_x: 'tok en',
    'bad name': 'dropped',
  },
};

describe('tmux session commands', () => {
  it('names a session after the Spark terminal session', () => {
    expect(sessionName('abc')).toBe('spark-abc');
  });

  it('quotes the folder, arguments and environment so tmux reads each one as written', () => {
    const command = launchCommand(start);
    expect(
      command.startsWith("new-session -d -s 'spark-7f1e3b3a-0000-4000-8000-000000000001'"),
    ).toBe(true);
    expect(command).toContain('-x 120 -y 40');
    expect(command).toContain(
      "-e 'PATH=/usr/bin' -e 'SHELL=/bin/zsh' -e 'SPARK_NATIVE_MCP_TOKEN_x=tok en' --",
    );
    expect(command).not.toContain('bad name');
    expect(command).toContain("'/work/it'\\''s here' '/bin/zsh' '' '' '/usr/local/bin/claude'");
    expect(command).toContain("'line one\nline '\\''two'\\'' #{pane_id} $(id)' '--' 'hi'");
  });

  it('holds the command until Spark is attached and hides tmux from it', () => {
    const command = launchCommand(start);
    expect(command).toContain("'/bin/sh' '-c' 'stty -echo; IFS= read -r _; stty echo;");
    expect(command).toContain('unset TMUX TMUX_PANE OLDPWD');
    expect(command).toContain('for name in SHELL TERM_PROGRAM TERM_PROGRAM_VERSION; do shift;');
    expect(command).toContain('exec "$@"');
  });

  it('refuses a session id that is not a plain identifier', () => {
    expect(() => launchCommand({ ...start, sessionId: "x'; kill-server" })).toThrow('Invalid');
  });

  it('reads a running pane and a pane whose command ended', () => {
    expect(parsePane('%3 4242 0 100 30 [] []')).toEqual({
      paneId: '%3',
      pid: 4242,
      dead: false,
      exitCode: null,
      signal: null,
      cols: 100,
      rows: 30,
    });
    expect(parsePane('%3 4242 1 100 30 [2] []')).toMatchObject({ dead: true, exitCode: 2 });
    expect(parsePane('%3 4242 1 100 30 [] [9]')).toMatchObject({ exitCode: null, signal: 9 });
    expect(parsePane('no such session')).toBeNull();
  });

  it('maps the pane status to the exit Spark records', () => {
    expect(paneExit({ exitCode: 0, signal: null })).toEqual({ exitCode: 0 });
    expect(paneExit({ exitCode: 3, signal: null })).toEqual({ exitCode: 3 });
    expect(paneExit({ exitCode: null, signal: 9 })).toEqual({ exitCode: 0, signal: 9 });
  });

  it('writes typed bytes as hexadecimal keys', () => {
    expect(hexWords(Buffer.from('é\r\x1b[Z', 'utf8'))).toBe('c3 a9 0d 1b 5b 5a');
  });
});
