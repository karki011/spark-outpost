import type { BrowserInspectResult } from '@spark-outpost/contracts';
import { describeTarget } from './act-target.ts';
import type { Cdp } from './cdp.ts';
import { quadBox } from './mask.ts';
import { PageToolError } from './page-read.ts';
import type { RefMap } from './ref-map.ts';
import { pageDocument, resolveRef } from './ref-resolve.ts';
import { callOnNode, releaseWorld, sparkWorld } from './spark-world.ts';

type Element = NonNullable<BrowserInspectResult['element']>;

const STYLE_NAMES = [
  'display',
  'position',
  'top',
  'left',
  'width',
  'height',
  'margin',
  'padding',
  'box-sizing',
  'overflow',
  'z-index',
  'opacity',
  'visibility',
  'pointer-events',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'transform',
  'cursor',
];

const READ_STYLES = `function (names) {
  const style = getComputedStyle(this);
  const picked = {};
  for (const name of names) picked[name] = style.getPropertyValue(name);
  return { styles: picked, children: this.childElementCount };
}`;

const HIDDEN_ATTRIBUTES = new Set(['value']);

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export const BAD_SELECTOR = 'That is not a CSS selector the page can use.';

async function bySelector(
  cdp: Cdp,
  selector: string,
): Promise<{ node: number | null; matched: number }> {
  const { root } = await cdp.send<{ root: { nodeId: number } }>('DOM.getDocument', { depth: 0 });
  const found = await cdp
    .send<{ nodeIds: number[] }>('DOM.querySelectorAll', { nodeId: root.nodeId, selector })
    .catch(() => {
      throw new PageToolError('failed', BAD_SELECTOR);
    });
  const first = found.nodeIds[0];
  if (first === undefined) return { node: null, matched: 0 };
  const { node } = await cdp.send<{ node: { backendNodeId: number } }>('DOM.describeNode', {
    nodeId: first,
  });
  return { node: node.backendNodeId, matched: found.nodeIds.length };
}

async function attributesOf(cdp: Cdp, node: number, masked: boolean) {
  const described = await cdp.send<{ node: { nodeName: string; attributes?: string[] } }>(
    'DOM.describeNode',
    { backendNodeId: node },
  );
  const list = described.node.attributes ?? [];
  const attributes: Record<string, string> = {};
  for (let index = 0; index + 1 < list.length && index < 80; index += 2) {
    const name = list[index]!.toLowerCase().slice(0, 100);
    attributes[name] =
      masked && HIDDEN_ATTRIBUTES.has(name) ? '[masked]' : clip(list[index + 1]!, 500);
  }
  return { tag: described.node.nodeName.toLowerCase().slice(0, 60), attributes };
}

async function boxes(cdp: Cdp, node: number) {
  const model = await cdp
    .send<{ model: { border: number[]; margin: number[] } }>('DOM.getBoxModel', {
      backendNodeId: node,
    })
    .catch(() => null);
  return {
    box: model ? quadBox(model.model.border) : null,
    margin: model ? quadBox(model.model.margin) : null,
  };
}

export async function inspectElement(
  cdp: Cdp,
  refs: RefMap,
  wanted: { ref?: string | undefined; selector?: string | undefined },
  filled: ReadonlySet<number>,
): Promise<{ matched: number; element: Element | null }> {
  let node: number | null;
  let matched = 1;
  if (wanted.ref !== undefined) {
    node = (await resolveRef(cdp, refs, wanted.ref, await pageDocument(cdp), 'read')).node;
  } else if (wanted.selector !== undefined) {
    ({ node, matched } = await bySelector(cdp, wanted.selector));
  } else {
    throw new PageToolError('no_ref', 'Pass a ref from spark_browser_read or a CSS selector.');
  }
  if (node === null) return { matched: 0, element: null };
  const target = await describeTarget(cdp, node, filled);
  const { tag, attributes } = await attributesOf(cdp, node, target.sensitive);
  const world = await sparkWorld(cdp);
  const read = await callOnNode<{ styles: Record<string, string>; children: number }>(
    cdp,
    world,
    node,
    READ_STYLES.replace('function (names)', `function (names = ${JSON.stringify(STYLE_NAMES)})`),
  ).catch(() => null);
  await releaseWorld(cdp);
  const styles = Object.fromEntries(
    Object.entries(read?.styles ?? {})
      .filter(([, value]) => value !== '')
      .map(([name, value]) => [name, clip(value, 200)]),
  );
  return {
    matched,
    element: {
      tag,
      role: target.role,
      name: target.name,
      attributes,
      styles,
      ...(await boxes(cdp, node)),
      children: read?.children ?? 0,
      masked: target.sensitive,
    },
  };
}
