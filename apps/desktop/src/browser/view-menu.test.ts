import { describe, expect, it } from 'vitest';
import { viewMenuItems } from './view-menu.ts';

const none = { selectionText: '', isEditable: false, linkURL: '' };

describe('the Browser view page menu', () => {
  it('offers a web link in a new tab and its copy', () => {
    expect(viewMenuItems({ ...none, linkURL: 'https://example.com/a' })).toEqual([
      { kind: 'open_link', label: 'Open link in new tab', url: 'https://example.com/a' },
      { kind: 'link_chat', label: 'Open link in new chat', url: 'https://example.com/a' },
      { kind: 'copy_link', label: 'Copy link', url: 'https://example.com/a' },
    ]);
  });

  it('offers nothing for a link that is not a web address', () => {
    for (const linkURL of ['javascript:alert(1)', 'file:///etc/hosts', 'https://u:p@example.com']) {
      expect(viewMenuItems({ ...none, linkURL })).toEqual([]);
    }
  });

  it('offers a new chat and Copy for selected page text, never in a field', () => {
    expect(viewMenuItems({ ...none, selectionText: 'hello' })).toEqual([
      { kind: 'selection_chat', label: 'New chat with this', text: 'hello' },
      { kind: 'copy', label: 'Copy' },
    ]);
    expect(viewMenuItems({ ...none, selectionText: 'key=AKIAABCDEFGHIJKLMNOP' })[0]).toEqual({
      kind: 'selection_chat',
      label: 'New chat with this',
      text: expect.not.stringContaining('AKIAABCDEFGHIJKLMNOP'),
    });
    expect(viewMenuItems({ ...none, selectionText: 'hello', isEditable: true })).toEqual([]);
    expect(
      viewMenuItems({ ...none, selectionText: 'hello', linkURL: 'https://example.com' }),
    ).toEqual([
      { kind: 'open_link', label: 'Open link in new tab', url: 'https://example.com' },
      { kind: 'link_chat', label: 'Open link in new chat', url: 'https://example.com' },
      { kind: 'copy_link', label: 'Copy link', url: 'https://example.com' },
      { kind: 'separator' },
      { kind: 'selection_chat', label: 'New chat with this', text: 'hello' },
      { kind: 'copy', label: 'Copy' },
    ]);
  });
});
