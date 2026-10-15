import { describe, expect, it } from 'vitest';
import { ACT_NOT_VISIBLE } from './act-point.ts';
import { ACT_FOCUS_LOST, ACT_SENSITIVE_FIELD, actOnPage } from './agent-act.ts';
import type { Cdp, CdpListener } from './cdp.ts';
import {
  HitDom,
  type Box,
  type ElementOptions,
  type HitElement,
  type HitParent,
} from './hit-dom.fixture.ts';
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
  element?: HitElement;
}

type Probe = (this: unknown, ...args: unknown[]) => unknown;

class FakePage {
  readonly nodes = new Map<number, FakeNode>();
  readonly sent: Sent[] = [];
  readonly history: string[] = [];
  readonly dom = new HitDom();
  readonly body = this.dom.add('BODY', this.dom.document, {
    box: { left: 0, top: 0, right: 1000, bottom: 500 },
  });
  readonly handles = new Map<string, unknown>();
  onMouseMove: () => void = () => undefined;
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
    if (method === 'DOM.describeNode' && typeof params.objectId === 'string') {
      return { node: { backendNodeId: this.idOf(this.handles.get(params.objectId)) } };
    }
    if (method === 'DOM.describeNode') {
      return {
        node: { backendNodeId: id, nodeName: node?.tag ?? 'DIV', attributes: node?.attributes },
      };
    }
    if (method === 'DOM.getContentQuads') {
      const box = node?.element?.box;
      if (!box) throw new Error('no box');
      return {
        quads: [
          [box.left, box.top, box.right, box.top, box.right, box.bottom, box.left, box.bottom],
        ],
      };
    }
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 9 };
    if (method === 'DOM.resolveNode') return { object: { objectId: this.handle(node?.element) } };
    if (method === 'Runtime.callFunctionOn') return this.callOn(params);
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseMoved') this.onMouseMove();
    if (method === 'DOM.focus') this.focused = this.stealsFocus ? null : id;
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } };
    }
    return {};
  }

  add(
    id: number,
    node: Omit<FakeNode, 'element'>,
    tag: string,
    options: ElementOptions,
    parent: HitParent = this.body,
  ): void {
    this.nodes.set(id, { ...node, element: this.dom.add(tag, parent, options) });
  }

  private handle(element: unknown): string | undefined {
    if (element === undefined) return undefined;
    const objectId = `object-${this.handles.size + 1}`;
    this.handles.set(objectId, element);
    return objectId;
  }

  private idOf(element: unknown): number {
    for (const [id, node] of this.nodes) if (node.element === element) return id;
    return 0;
  }

  private callOn(params: Record<string, unknown>): unknown {
    const probe = new Function(`return (${String(params.functionDeclaration)})`)() as Probe;
    const args = (params.arguments as { value: unknown }[]).map((entry) => entry.value);
    const value = probe.call(this.handles.get(String(params.objectId)), ...args);
    if (params.returnByValue) return { result: { value } };
    return { result: { objectId: this.handle(value ?? undefined) } };
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

function box(left: number, top: number, right: number, bottom: number): Box {
  return { left, top, right, bottom };
}

const BUTTON = box(10, 20, 110, 60);

function page(): FakePage {
  const fake = new FakePage();
  fake.add(1, { role: 'button', name: 'Search' }, 'BUTTON', { box: BUTTON });
  fake.add(
    2,
    { role: 'textbox', name: 'Query', tag: 'INPUT', attributes: ['type', 'text'] },
    'INPUT',
    { box: box(10, 80, 210, 110) },
  );
  fake.add(
    3,
    { role: 'textbox', name: 'Your key', tag: 'INPUT', attributes: ['type', 'password'] },
    'INPUT',
    { box: box(10, 120, 210, 150) },
  );
  fake.add(4, { role: 'textbox', name: 'Card number', tag: 'INPUT', attributes: [] }, 'INPUT', {
    box: box(10, 160, 210, 190),
  });
  fake.add(5, { role: 'link', name: 'Gone' }, 'A', {});
  return fake;
}

function cookieBanner(fake: FakePage, bottom: number): void {
  fake.add(20, { role: 'dialog', name: 'Cookie consent' }, 'DIV', {
    box: box(0, 0, 1000, bottom),
    style: { position: 'fixed' },
    attributes: { role: 'dialog', 'aria-label': 'Cookie consent' },
  });
  const banner = fake.nodes.get(20)!.element!;
  fake.dom.add('P', banner, { box: box(0, 0, 1000, bottom) });
}

function clickRef7(fake: FakePage) {
  return actOnPage(fake.cdp, { action: 'click', node: 1, ref: 'ref_7' }, fake.options());
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

  it("checks the point from Spark's own isolated world, not the page's", async () => {
    const fake = page();
    await actOnPage(fake.cdp, { action: 'click', node: 1 }, fake.options());
    expect(fake.methods('Page.createIsolatedWorld')[0]!.params).toMatchObject({
      worldName: 'spark-act',
    });
    expect(fake.methods('DOM.resolveNode')[0]!.params).toMatchObject({
      backendNodeId: 1,
      executionContextId: 9,
    });
  });

  it('refuses a click on an element a cookie banner covers and names the banner', async () => {
    const fake = page();
    cookieBanner(fake, 100);
    await expect(clickRef7(fake)).rejects.toMatchObject({
      code: 'failed',
      message: "ref_7 is covered by dialog 'Cookie consent'. Close or act on that first.",
    });
    expect(fake.methods('Input.')).toEqual([]);
  });

  it('clicks a part of a partly covered element that is clear', async () => {
    const fake = page();
    cookieBanner(fake, 45);
    await clickRef7(fake);
    expect(fake.methods('Input.dispatchMouseEvent').map((entry) => entry.params.type)).toEqual([
      'mouseMoved',
      'mousePressed',
      'mouseReleased',
    ]);
    expect(fake.methods('Input.dispatchMouseEvent')[1]!.params).toMatchObject({ x: 60, y: 54 });
  });

  it('refuses a transparent overlay over the element', async () => {
    const fake = page();
    fake.add(21, { role: 'generic', name: '' }, 'DIV', {
      box: box(0, 0, 1000, 500),
      style: { opacity: '0' },
    });
    await expect(clickRef7(fake)).rejects.toMatchObject({
      message: 'ref_7 is covered by a generic element with no name. Close or act on that first.',
    });
    expect(fake.methods('Input.')).toEqual([]);
  });

  it('leaves the name of a covering sensitive field out of the refusal', async () => {
    const fake = page();
    fake.add(22, { role: 'textbox', name: 'Card number' }, 'INPUT', { box: BUTTON });
    await expect(clickRef7(fake)).rejects.toMatchObject({
      message: 'ref_7 is covered by a textbox element with no name. Close or act on that first.',
    });
  });

  it('refuses an element that takes no clicks or that nobody can see', async () => {
    const fake = page();
    fake.add(6, { role: 'button', name: 'Ghost' }, 'BUTTON', {
      box: box(300, 20, 400, 60),
      style: { pointerEvents: 'none' },
    });
    const faded = fake.dom.add('DIV', fake.body, { style: { opacity: '0' } });
    fake.add(7, { role: 'textbox', name: 'Note' }, 'INPUT', { box: box(300, 80, 400, 110) }, faded);
    await expect(
      actOnPage(fake.cdp, { action: 'click', node: 6, ref: 'ref_6' }, fake.options()),
    ).rejects.toMatchObject({
      message: 'ref_6 does not take clicks (pointer-events: none). Act on the element that does.',
    });
    await expect(
      actOnPage(fake.cdp, { action: 'type', node: 7, ref: 'ref_7', text: 'x' }, fake.options()),
    ).rejects.toMatchObject({
      message:
        'ref_7 is hidden or fully transparent, so a person could not see it. Spark does not act on it.',
    });
    expect(fake.methods('Input.')).toEqual([]);
    expect(fake.methods('DOM.focus')).toEqual([]);
  });

  it('clicks a transparent checkbox that sits on top of its styled box', async () => {
    const fake = page();
    fake.dom.add('SPAN', fake.body, { box: box(500, 20, 520, 40) });
    fake.add(9, { role: 'checkbox', name: 'Agree' }, 'INPUT', {
      box: box(500, 20, 520, 40),
      style: { opacity: '0' },
    });
    await actOnPage(fake.cdp, { action: 'click', node: 9, ref: 'ref_9' }, fake.options());
    expect(fake.methods('Input.dispatchMouseEvent')[1]!.params).toMatchObject({ x: 510, y: 30 });
  });

  const HIDDEN_FIELD =
    'ref_10 is hidden or fully transparent, so a person could not see it. Spark does not act on it.';

  it.each([
    [
      'a transparent text field',
      { box: box(300, 80, 400, 110), style: { opacity: '0' } },
      HIDDEN_FIELD,
    ],
    ['a field with no size', { box: box(300, 80, 300, 80) }, ACT_NOT_VISIBLE],
    ['a field placed off the screen', { box: box(-9999, 80, -9800, 110) }, ACT_NOT_VISIBLE],
  ])('types nothing into %s', async (_what, options, message) => {
    const fake = page();
    fake.add(10, { role: 'textbox', name: 'Website' }, 'INPUT', options);
    await expect(
      actOnPage(fake.cdp, { action: 'type', node: 10, ref: 'ref_10', text: 'x' }, fake.options()),
    ).rejects.toMatchObject({ message });
    expect(fake.methods('DOM.focus')).toEqual([]);
    expect(fake.methods('Input.')).toEqual([]);
  });

  it('clicks an element inside a shadow root and refuses one covered inside it', async () => {
    const fake = page();
    const host = fake.dom.add('MY-PICKER', fake.body, { box: box(300, 200, 500, 300) });
    const shadow = fake.dom.shadowOf(host);
    fake.add(
      8,
      { role: 'button', name: 'Pick' },
      'BUTTON',
      { box: box(300, 200, 400, 240) },
      shadow,
    );
    fake.dom.add('SPAN', fake.nodes.get(8)!.element!, { box: box(320, 210, 380, 230) });
    await actOnPage(fake.cdp, { action: 'click', node: 8 }, fake.options());
    expect(fake.methods('Input.dispatchMouseEvent')[1]!.params).toMatchObject({ x: 350, y: 220 });
    fake.add(
      23,
      { role: 'tooltip', name: 'Hint' },
      'DIV',
      { box: box(300, 200, 500, 300), attributes: { role: 'tooltip' } },
      shadow,
    );
    await expect(
      actOnPage(fake.cdp, { action: 'click', node: 8, ref: 'ref_8' }, fake.options()),
    ).rejects.toMatchObject({
      message: "ref_8 is covered by tooltip 'Hint'. Close or act on that first.",
    });
  });

  it('presses nothing when a cover appears as the pointer arrives', async () => {
    const fake = page();
    fake.onMouseMove = () => cookieBanner(fake, 100);
    await expect(clickRef7(fake)).rejects.toMatchObject({
      message: "ref_7 is covered by dialog 'Cookie consent'. Close or act on that first.",
    });
    expect(fake.methods('Input.dispatchMouseEvent').map((entry) => entry.params.type)).toEqual([
      'mouseMoved',
    ]);
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
