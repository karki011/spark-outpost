import { describe, expect, it } from 'vitest';
import { viewMenuItems } from './view-menu.ts';

const none = { selectionText: '', isEditable: false, linkURL: '' };

describe('the Browser view page menu', () => {
  it('offers a web link in a new tab and its copy', () => {
    expect(viewMenuItems({ ...none, linkURL: 'https://example.com/a' })).toEqual([
      { kind: 'open_link', label: 'Open Link in New Tab', url: 'https://example.com/a' },
      { kind: 'copy_link', label: 'Copy Link', url: 'https://example.com/a' },
    ]);
  });

  it('offers nothing for a link that is not a web address', () => {
    for (const linkURL of ['javascript:alert(1)', 'file:///etc/hosts', 'https://u:p@example.com']) {
      expect(viewMenuItems({ ...none, linkURL })).toEqual([]);
    }
  });

  it('offers Copy for selected page text, never in a field', () => {
    expect(viewMenuItems({ ...none, selectionText: 'hello' })).toEqual([
      { kind: 'copy', label: 'Copy' },
    ]);
    expect(viewMenuItems({ ...none, selectionText: 'hello', isEditable: true })).toEqual([]);
    expect(
      viewMenuItems({ ...none, selectionText: 'hello', linkURL: 'https://example.com' }),
    ).toEqual([
      { kind: 'open_link', label: 'Open Link in New Tab', url: 'https://example.com' },
      { kind: 'copy_link', label: 'Copy Link', url: 'https://example.com' },
      { kind: 'separator' },
      { kind: 'copy', label: 'Copy' },
    ]);
  });
});
