import type { BrowserActKey } from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import type { AxNode } from './outline.ts';

interface KeyFacts {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  nativeVirtualKeyCode: number;
  text?: string;
}

function keyFacts(key: string, code: string, virtual: number, text?: string): KeyFacts {
  return {
    key,
    code,
    windowsVirtualKeyCode: virtual,
    nativeVirtualKeyCode: virtual,
    ...(text === undefined ? {} : { text }),
  };
}

const KEYS: Readonly<Record<BrowserActKey, KeyFacts>> = {
  Enter: keyFacts('Enter', 'Enter', 13, '\r'),
  Tab: keyFacts('Tab', 'Tab', 9),
  Escape: keyFacts('Escape', 'Escape', 27),
  Space: keyFacts(' ', 'Space', 32, ' '),
  Backspace: keyFacts('Backspace', 'Backspace', 8),
  Delete: keyFacts('Delete', 'Delete', 46),
  ArrowUp: keyFacts('ArrowUp', 'ArrowUp', 38),
  ArrowDown: keyFacts('ArrowDown', 'ArrowDown', 40),
  ArrowLeft: keyFacts('ArrowLeft', 'ArrowLeft', 37),
  ArrowRight: keyFacts('ArrowRight', 'ArrowRight', 39),
  PageUp: keyFacts('PageUp', 'PageUp', 33),
  PageDown: keyFacts('PageDown', 'PageDown', 34),
  Home: keyFacts('Home', 'Home', 36),
  End: keyFacts('End', 'End', 35),
};
const SELECT_ALL = keyFacts('a', 'KeyA', 65);

export async function hasFocus(cdp: Cdp, node: number): Promise<boolean> {
  const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getPartialAXTree', {
    backendNodeId: node,
    fetchRelatives: false,
  });
  return nodes.some(
    (candidate) =>
      candidate.backendDOMNodeId === node &&
      (candidate.properties ?? []).some(
        (property) => property.name === 'focused' && property.value.value === true,
      ),
  );
}

export async function focusNode(cdp: Cdp, node: number): Promise<boolean> {
  await cdp.send('DOM.focus', { backendNodeId: node });
  return hasFocus(cdp, node);
}

export async function replaceFocusedText(cdp: Cdp, text: string): Promise<void> {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    ...SELECT_ALL,
    commands: ['selectAll'],
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...SELECT_ALL });
  await cdp.send('Input.insertText', { text });
}

export async function pressKey(cdp: Cdp, key: BrowserActKey): Promise<void> {
  const facts = KEYS[key];
  const { text, ...plain } = facts;
  await cdp.send('Input.dispatchKeyEvent', {
    type: text === undefined ? 'rawKeyDown' : 'keyDown',
    ...facts,
  });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...plain });
}
