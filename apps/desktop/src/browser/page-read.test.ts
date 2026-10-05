import { describe, expect, it } from 'vitest';
import type { Cdp } from './cdp.ts';
import { RefMap } from './outline.ts';
import { readPage } from './page-read.ts';

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
