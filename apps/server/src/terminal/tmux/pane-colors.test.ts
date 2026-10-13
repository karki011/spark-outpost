import { describe, expect, it } from 'vitest';
import { colorReportCommands } from './pane-colors.ts';

describe('colorReportCommands', () => {
  it('reports the foreground and background to tmux as the terminal would answer them', () => {
    expect(colorReportCommands('%3', { foreground: '#241a13', background: '#FAF2EB' })).toEqual([
      'refresh-client -r "%3:\\e]10;rgb:2424/1a1a/1313\\e\\\\"',
      'refresh-client -r "%3:\\e]11;rgb:fafa/f2f2/ebeb\\e\\\\"',
    ]);
  });

  it('leaves out a colour that is not six hexadecimal digits', () => {
    expect(
      colorReportCommands('%3', { foreground: 'red"; kill-server; "', background: '#000000' }),
    ).toEqual(['refresh-client -r "%3:\\e]11;rgb:0000/0000/0000\\e\\\\"']);
  });
});
