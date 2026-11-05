import { describe, expect, it } from 'vitest';
import { appendLogLine, methodLabel, parseLabelSegments, resolveLastLine } from './verify-log.ts';

describe('parseLabelSegments', () => {
  it('returns a single plain segment when there is no inline code', () => {
    expect(parseLabelSegments('Checking your CLI login')).toEqual([
      { text: 'Checking your CLI login', code: false },
    ]);
  });

  it('splits text around one inline code span', () => {
    expect(parseLabelSegments('Looking for `claude` on your PATH')).toEqual([
      { text: 'Looking for ', code: false },
      { text: 'claude', code: true },
      { text: ' on your PATH', code: false },
    ]);
  });

  it('handles multiple inline code spans in one label', () => {
    expect(parseLabelSegments('Found `claude 2.4.1` at `/usr/local/bin/claude`')).toEqual([
      { text: 'Found ', code: false },
      { text: 'claude 2.4.1', code: true },
      { text: ' at ', code: false },
      { text: '/usr/local/bin/claude', code: true },
    ]);
  });

  it('handles a label made only of inline code', () => {
    expect(parseLabelSegments('`codex`')).toEqual([{ text: 'codex', code: true }]);
  });
});

describe('appendLogLine and resolveLastLine', () => {
  it('appends a pending line and resolves it to good or bad', () => {
    let lines = appendLogLine([], 1, 'Checking key format');
    expect(lines).toEqual([{ id: 1, label: 'Checking key format', status: 'pending' }]);
    lines = resolveLastLine(lines, 'Format looks right', 'good');
    expect(lines).toEqual([{ id: 1, label: 'Format looks right', status: 'good' }]);
    lines = appendLogLine(lines, 2, 'Verifying with Anthropic');
    lines = resolveLastLine(lines, 'Anthropic rejected this key', 'bad');
    expect(lines).toEqual([
      { id: 1, label: 'Format looks right', status: 'good' },
      { id: 2, label: 'Anthropic rejected this key', status: 'bad' },
    ]);
  });

  it('leaves an empty log untouched when resolving', () => {
    expect(resolveLastLine([], 'nothing to resolve', 'good')).toEqual([]);
  });
});

describe('methodLabel', () => {
  it('describes each connection method', () => {
    expect(methodLabel('cli')).toBe('local CLI');
    expect(methodLabel('api_key')).toBe('API key');
  });
});
