import { describe, expect, it } from 'vitest';
import type { Cdp } from './cdp.ts';
import { readPage } from './page-read.ts';
import { RefMap } from './ref-map.ts';
import { el, fakeCdp, text, type FakeDocument } from './ref-page.fixture.ts';

const USERNAME = 'vault-user@example.test';

function pageWithFilledField(): Cdp {
  const answers: Record<string, unknown> = {
    'Accessibility.getFullAXTree': {
      nodes: [
        {
          nodeId: '1',
          role: { value: 'RootWebArea' },
          name: { value: 'Sign in' },
          childIds: ['2'],
        },
        {
          nodeId: '2',
          parentId: '1',
          role: { value: 'textbox' },
          name: { value: 'Email' },
          value: { value: USERNAME },
          backendDOMNodeId: 7,
          childIds: ['3'],
        },
        { nodeId: '3', parentId: '2', role: { value: 'StaticText' }, name: { value: USERNAME } },
      ],
    },
    'DOM.getDocument': { root: { backendNodeId: 1, nodeName: 'HTML', children: [] } },
  };
  return {
    send: (method) => Promise.resolve(answers[method] as never),
    listen: () => () => undefined,
    detach: () => undefined,
  };
}

describe('reading a page Spark signed in on', () => {
  it('shows an ordinary field value until Spark has filled it', async () => {
    const page = await readPage(pageWithFilledField(), new RefMap(), { mode: 'tree', offset: 0 });
    expect(page.text).toContain(USERNAME);
  });

  it('masks the field Spark filled in the outline and leaves it out of the text', async () => {
    const filled = new Set([7]);
    const cdp = pageWithFilledField();
    const tree = await readPage(cdp, new RefMap(), { mode: 'tree', offset: 0 }, filled);
    expect(tree.text).toContain('textbox "Email" [ref_1] value=[masked]');
    expect(tree.text).not.toContain(USERNAME);
    expect(tree.masked).toBe(1);
    const text = await readPage(cdp, new RefMap(), { mode: 'text', offset: 0 }, filled);
    expect(text.text).not.toContain(USERNAME);
  });
});

function withDialog(modal: boolean, hit?: number): FakeDocument {
  return {
    documentId: 9000,
    ...(hit === undefined ? {} : { hit }),
    body: el(1, 'RootWebArea', 'Account', {
      tag: 'HTML',
      kids: [
        el(2, 'heading', 'Settings', { tag: 'H1' }),
        el(3, 'button', 'Delete account', { tag: 'BUTTON' }),
        el(10, 'dialog', 'Confirm', {
          modal,
          kids: [
            text(11, 'Type your password to go on'),
            el(12, 'textbox', 'Password', {
              tag: 'INPUT',
              attrs: ['type', 'password'],
              value: 'hunter2',
            }),
            el(13, 'button', 'Cancel', { tag: 'BUTTON' }),
          ],
        }),
      ],
    }),
  };
}

describe('reading while a dialog is open', () => {
  it('reads only a modal dialog, keeps its password masked and says how to read the page', async () => {
    const refs = new RefMap();
    const cdp = fakeCdp(() => withDialog(true));
    const page = await readPage(cdp, refs, { mode: 'tree', offset: 0 });
    expect(page).toMatchObject({ dialog: true, masked: 1 });
    expect(page.text).toContain('dialog "Confirm"');
    expect(page.text).toContain('textbox "Password" [ref_');
    expect(page.text).toContain('value=[masked]');
    expect(page.text).not.toMatch(/hunter2|Delete account|Settings/);
    const whole = await readPage(cdp, refs, { mode: 'tree', offset: 0, ref: page.pageRef });
    expect(whole.text).toContain('Delete account');
    expect(whole.text).not.toContain('hunter2');
    expect(whole.dialog).toBeUndefined();
  });

  it('scopes the text of the page to the dialog too', async () => {
    const page = await readPage(
      fakeCdp(() => withDialog(true)),
      new RefMap(),
      {
        mode: 'text',
        offset: 0,
      },
    );
    expect(page).toMatchObject({ dialog: true, text: 'Type your password to go on' });
  });

  it('reads the whole page when a dialog that is not modal sits away from the middle', async () => {
    const page = await readPage(
      fakeCdp(() => withDialog(false, 3)),
      new RefMap(),
      {
        mode: 'tree',
        offset: 0,
      },
    );
    expect(page.dialog).toBeUndefined();
    expect(page.text).toContain('Delete account');
  });

  it('treats a dialog that covers the middle of the view as the one to read', async () => {
    const page = await readPage(
      fakeCdp(() => withDialog(false, 13)),
      new RefMap(),
      {
        mode: 'tree',
        offset: 0,
      },
    );
    expect(page.dialog).toBe(true);
    expect(page.text).not.toContain('Delete account');
  });
});
