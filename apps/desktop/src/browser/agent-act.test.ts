import { describe, expect, it } from 'vitest';
import { ACT_FOCUS_LOST, ACT_NOT_VISIBLE, ACT_SENSITIVE_FIELD, actOnPage } from './agent-act.ts';
import type { Cdp, CdpListener } from './cdp.ts';
import { PageToolError } from './page-read.ts';

const TIMING = { settleMs: 5, loadMs: 60, restMs: 1 };

interface Sent {
  method: string;
  params: Record<string, unknown>;
}

interface FakeNode {
  role: string;
  name: string;
  tag?: string;
  attributes?: string[];
  hidden?: boolean;
}

class FakePage {
  readonly nodes = new Map<number, FakeNode>();
  readonly sent: Sent[] = [];
  readonly history: string[] = [];
  focused: number | null = null;
  stealsFocus = false;
  canGoBack = true;
  private readonly listeners = new Set<CdpListener>();

  readonly cdp: Cdp = {
    send: (method, params = {}) => Promise.resolve(this.answer(method, params) as never),
    listen: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    detach: () => this.listeners.clear(),
  };

  private answer(method: string, params: Record<string, unknown>): unknown {
    this.sent.push({ method, params });
    const id = Number(params.backendNodeId);
    const node = this.nodes.get(id);
    if (method === 'Accessibility.getPartialAXTree') {
      return {
        nodes: [
          {
            nodeId: '1',
            backendDOMNodeId: id,
            role: { value: node?.role },
            name: { value: node?.name },
            properties: [{ name: 'focused', value: { value: this.focused === id } }],
          },
        ],
      };
    }
    if (method === 'DOM.describeNode') {
      return {
        node: { backendNodeId: id, nodeName: node?.tag ?? 'DIV', attributes: node?.attributes },
      };
    }
    if (method === 'DOM.getBoxModel') {
      if (node?.hidden) throw new Error('no box');
      return { model: { border: [10, 20, 110, 20, 110, 60, 10, 60] } };
    }
    if (method === 'DOM.focus') this.focused = this.stealsFocus ? null : id;
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } };
    }
    return {};
  }

  methods(prefix: string): Sent[] {
    return this.sent.filter((entry) => entry.method.startsWith(prefix));
  }

  options(filled: number[] = []) {
    return {
      filled: new Set(filled),
      history: (step: 'back' | 'forward' | 'reload') => {
        if (step === 'back' && !this.canGoBack) return false;
        this.history.push(step);
        return true;
      },
      signal: new AbortController().signal,
      timing: TIMING,
      highlightMs: 1,
    };
  }
}

function page(): FakePage {
  const fake = new FakePage();
  fake.nodes.set(1, { role: 'button', name: 'Search' });
  fake.nodes.set(2, { role: 'textbox', name: 'Query', tag: 'INPUT', attributes: ['type', 'text'] });
  fake.nodes.set(3, {
    role: 'textbox',
    name: 'Your key',
    tag: 'INPUT',
    attributes: ['type', 'password'],
  });
  fake.nodes.set(4, { role: 'textbox', name: 'Card number', tag: 'INPUT', attributes: [] });
  fake.nodes.set(5, { role: 'link', name: 'Gone', hidden: true });
  return fake;
}

describe('an agent acting on a page', () => {
  it('clicks the middle of the element, highlights it and says what it clicked', async () => {
    const fake = page();
    const target = await actOnPage(fake.cdp, { action: 'click', node: 1 }, fake.options());
    expect(target).toEqual({ role: 'button', name: 'Search', sensitive: false });
    expect(fake.methods('Overlay.highlightNode')).toHaveLength(1);
    expect(fake.methods('Input.dispatchMouseEvent').map((entry) => entry.params)).toEqual([
      { type: 'mouseMoved', x: 60, y: 40 },
      { type: 'mousePressed', x: 60, y: 40, button: 'left', clickCount: 1 },
      { type: 'mouseReleased', x: 60, y: 40, button: 'left', clickCount: 1 },
    ]);
  });

  it('replaces the text of a field after checking it took the cursor', async () => {
    const fake = page();
    await actOnPage(fake.cdp, { action: 'type', node: 2, text: 'refund policy' }, fake.options());
    expect(fake.focused).toBe(2);
    expect(fake.methods('Input.insertText').map((entry) => entry.params)).toEqual([
      { text: 'refund policy' },
    ]);
  });

  it.each([
    ['a password field', 3, []],
    ['a field named like a card number', 4, []],
    ['a field Spark filled with a saved sign-in', 2, [2]],
  ])('never types into %s', async (_what, node, filled) => {
    const fake = page();
    const typing = actOnPage(
      fake.cdp,
      { action: 'type', node, text: 'hunter2-hunter2' },
      fake.options(filled),
    );
    await expect(typing).rejects.toMatchObject({
      code: 'sensitive_field',
      message: ACT_SENSITIVE_FIELD,
    });
    expect(fake.methods('Input.')).toEqual([]);
    expect(fake.methods('DOM.focus')).toEqual([]);
  });

  it('leaves the name of a sensitive field out of what it reports', async () => {
    const fake = page();
    const target = await actOnPage(fake.cdp, { action: 'click', node: 3 }, fake.options());
    expect(target).toEqual({ role: 'textbox', name: '', sensitive: true });
  });

  it('types nothing when the page moves the cursor away', async () => {
    const fake = page();
    fake.stealsFocus = true;
    const typing = actOnPage(fake.cdp, { action: 'type', node: 2, text: 'x' }, fake.options());
    await expect(typing).rejects.toMatchObject({ code: 'failed', message: ACT_FOCUS_LOST });
    expect(fake.methods('Input.insertText')).toEqual([]);
  });

  it('refuses an element that is not on screen and a click with no ref', async () => {
    const fake = page();
    await expect(
      actOnPage(fake.cdp, { action: 'click', node: 5 }, fake.options()),
    ).rejects.toMatchObject({ code: 'no_ref', message: ACT_NOT_VISIBLE });
    await expect(
      actOnPage(fake.cdp, { action: 'click', node: null }, fake.options()),
    ).rejects.toBeInstanceOf(PageToolError);
    expect(fake.methods('Input.')).toEqual([]);
  });

  it('presses a key, in a field when one is named', async () => {
    const fake = page();
    const target = await actOnPage(
      fake.cdp,
      { action: 'key', node: 2, key: 'Enter' },
      fake.options(),
    );
    expect(target?.name).toBe('Query');
    expect(fake.focused).toBe(2);
    expect(fake.methods('Input.dispatchKeyEvent').map((entry) => entry.params)).toEqual([
      expect.objectContaining({ type: 'keyDown', key: 'Enter', text: '\r' }),
      expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
    ]);
    fake.sent.length = 0;
    await actOnPage(fake.cdp, { action: 'key', node: null, key: 'ArrowDown' }, fake.options());
    expect(fake.methods('Input.dispatchKeyEvent')[0]!.params).toMatchObject({
      type: 'rawKeyDown',
      key: 'ArrowDown',
    });
  });

  it('scrolls most of a screen from the middle of the page', async () => {
    const fake = page();
    await actOnPage(fake.cdp, { action: 'scroll', node: null, direction: 'up' }, fake.options());
    expect(fake.methods('Input.dispatchMouseEvent')[0]!.params).toEqual({
      type: 'mouseWheel',
      x: 500,
      y: 250,
      deltaX: 0,
      deltaY: -400,
    });
  });

  it('goes back, forward and reloads through the tab, and says when there is nowhere to go', async () => {
    const fake = page();
    for (const action of ['back', 'forward', 'reload'] as const) {
      expect(await actOnPage(fake.cdp, { action, node: null }, fake.options())).toBeNull();
    }
    expect(fake.history).toEqual(['back', 'forward', 'reload']);
    fake.canGoBack = false;
    await expect(
      actOnPage(fake.cdp, { action: 'back', node: null }, fake.options()),
    ).rejects.toMatchObject({ code: 'failed' });
  });
});
