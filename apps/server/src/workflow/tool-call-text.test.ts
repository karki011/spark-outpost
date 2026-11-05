import { describe, expect, it } from 'vitest';
import { COMMAND_STORED_CHARS, COMMAND_TEXT_MAX } from '@spark-outpost/contracts';
import { toolArguments, toolResult } from './tool-call-text.ts';

describe('toolArguments', () => {
  it('redacts secrets by field name, by pattern and by project value', () => {
    const input = {
      command: 'deploy hunter2-value',
      token: 'abc',
      note: 'sk-proj-abcdefghijklmnopqrstuvwx',
    };
    const text = toolArguments(input, false, ['hunter2-value']);
    expect(text).toContain('deploy [redacted:secret_value]');
    expect(text).not.toContain('abc"');
    expect(text).not.toContain('sk-proj-');
  });

  it('keeps the path but not the file content of a call on a secret file', () => {
    const input = { file_path: '/work/app/.env', content: 'PLAIN=hello', new_string: 'B=2' };
    expect(JSON.parse(toolArguments(input, true, []))).toEqual({
      file_path: '/work/app/.env',
      content: '[redacted:secret_file]',
      new_string: '[redacted:secret_file]',
    });
  });

  it('clips long text at the command length limit and is empty without input', () => {
    const text = toolArguments({ content: 'x'.repeat(COMMAND_TEXT_MAX * 3) }, false, []);
    expect(text.length).toBeLessThanOrEqual(COMMAND_TEXT_MAX + 20);
    expect(toolArguments(null, false, [])).toBe('');
  });
});

describe('toolResult', () => {
  it('redacts the output and keeps only the stored tail', () => {
    const output = `${'line\n'.repeat(COMMAND_STORED_CHARS)}OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwx`;
    const text = toolResult(output, false, []);
    expect(text.length).toBeLessThanOrEqual(COMMAND_STORED_CHARS);
    expect(text).not.toContain('sk-proj-');
    expect(text.endsWith(']')).toBe(true);
  });

  it('strips terminal escape sequences that could act on the reader', () => {
    const output = '\u001b]0;owned\u0007\u001b]52;c;c3RvbGVu\u0007banner\n';
    expect(toolResult(output, false, [])).toBe('banner\n');
  });

  it('cleans a structured result field by field', () => {
    const output = { stdout: '\u001b]0;owned\u0007ok hunter2-value', token: 'abc', exitCode: 0 };
    expect(JSON.parse(toolResult(output, false, ['hunter2-value']))).toEqual({
      stdout: 'ok [redacted:secret_value]',
      token: expect.stringMatching(/^\[redacted:/),
      exitCode: 0,
    });
  });

  it('replaces everything a secret-file call returned', () => {
    expect(toolResult('PLAIN=hello', true, [])).toBe('[redacted:secret_file]');
    expect(toolResult('', true, [])).toBe('');
  });
});
