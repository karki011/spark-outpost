import {
  BROWSER_PICK_ELEMENTS_MAX,
  BROWSER_PICK_HTML_MAX,
  redactText,
  type BrowserBox,
  type BrowserPick,
  type PickedElement,
} from '@spark-outpost/contracts';
import type { Cdp } from './cdp.ts';
import type { AxNode } from './outline.ts';
import { boxOf, sensitiveBackendIds } from './page-read.ts';
import { capturePage } from './page-tools.ts';

export type PickMode = 'element' | 'region';

const PICK_IMAGE_WIDTH = 960;
const REGION_HTML_MAX = 300;
const SAMPLES_PER_SIDE = 4;
const CROP_PADDING = 8;
const STYLE_NAMES = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border',
  'border-radius',
  'opacity',
  'z-index',
];

const HIGHLIGHT = {
  showInfo: true,
  showStyles: false,
  contentColor: { r: 111, g: 168, b: 220, a: 0.45 },
  paddingColor: { r: 147, g: 196, b: 125, a: 0.35 },
  borderColor: { r: 255, g: 229, b: 153, a: 0.5 },
  marginColor: { r: 246, g: 178, b: 107, a: 0.35 },
};

function axText(value: { value?: unknown } | undefined): string {
  return typeof value?.value === 'string' ? value.value.replace(/\s+/g, ' ').trim() : '';
}

function compactHtml(html: string, max: number): string {
  const squeezed = redactText(html.replace(/\s+/g, ' ').trim());
  return squeezed.length <= max ? squeezed : `${squeezed.slice(0, max - 1)}…`;
}

function withoutValues(html: string): string {
  return html.replace(/\svalue=("[^"]*"|'[^']*'|[^\s>]+)/gi, ' value="[masked]"');
}

async function roleAndName(cdp: Cdp, backendNodeId: number) {
  try {
    const { nodes } = await cdp.send<{ nodes: AxNode[] }>('Accessibility.getPartialAXTree', {
      backendNodeId,
      fetchRelatives: false,
    });
    const node = nodes.find((candidate) => !candidate.ignored) ?? nodes[0];
    return { role: axText(node?.role) || 'generic', name: axText(node?.name) };
  } catch {
    return { role: 'generic', name: '' };
  }
}

async function computedStyles(cdp: Cdp, backendNodeId: number): Promise<Record<string, string>> {
  try {
    await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await cdp.send<{ nodeIds: number[] }>(
      'DOM.pushNodesByBackendIdsToFrontend',
      { backendNodeIds: [backendNodeId] },
    );
    await cdp.send('CSS.enable');
    const { computedStyle } = await cdp.send<{
      computedStyle: { name: string; value: string }[];
    }>('CSS.getComputedStyleForNode', { nodeId: nodeIds[0] });
    await cdp.send('CSS.disable');
    const wanted = new Set(STYLE_NAMES);
    return Object.fromEntries(
      computedStyle
        .filter((style) => wanted.has(style.name))
        .map((style) => [style.name, style.value.slice(0, 200)]),
    );
  } catch {
    return {};
  }
}

interface DescribeOptions {
  sensitive: ReadonlySet<number>;
  htmlMax: number;
  styles: boolean;
}

async function describeElement(
  cdp: Cdp,
  backendNodeId: number,
  options: DescribeOptions,
): Promise<PickedElement | null> {
  const box = await boxOf(cdp, backendNodeId);
  if (!box) return null;
  const { outerHTML } = await cdp
    .send<{ outerHTML: string }>('DOM.getOuterHTML', { backendNodeId })
    .catch(() => ({ outerHTML: '' }));
  const html = options.sensitive.size > 0 ? withoutValues(outerHTML) : outerHTML;
  return {
    ...(await roleAndName(cdp, backendNodeId)),
    html: compactHtml(html, options.htmlMax),
    styles: options.styles ? await computedStyles(cdp, backendNodeId) : {},
    box,
  };
}

function padded(box: BrowserBox): BrowserBox {
  const x = Math.max(0, box.x - CROP_PADDING);
  const y = Math.max(0, box.y - CROP_PADDING);
  return { x, y, width: box.width + CROP_PADDING * 2, height: box.height + CROP_PADDING * 2 };
}

async function cropped(
  cdp: Cdp,
  box: BrowserBox,
  filled: ReadonlySet<number>,
): Promise<string | null> {
  try {
    const shot = await capturePage(cdp, { box, maxWidth: PICK_IMAGE_WIDTH, filled });
    return `data:${shot.mediaType};base64,${shot.data.toString('base64')}`;
  } catch {
    return null;
  }
}

async function nodesInside(cdp: Cdp, box: BrowserBox): Promise<number[]> {
  const found = new Set<number>();
  for (let row = 0; row < SAMPLES_PER_SIDE; row += 1) {
    for (let column = 0; column < SAMPLES_PER_SIDE; column += 1) {
      const x = Math.round(box.x + (box.width * (column + 0.5)) / SAMPLES_PER_SIDE);
      const y = Math.round(box.y + (box.height * (row + 0.5)) / SAMPLES_PER_SIDE);
      const hit = await cdp
        .send<{ backendNodeId: number }>('DOM.getNodeForLocation', {
          x,
          y,
          ignorePointerEventsNone: true,
        })
        .catch(() => null);
      if (hit) found.add(hit.backendNodeId);
    }
  }
  return [...found].slice(0, BROWSER_PICK_ELEMENTS_MAX);
}

export type PickFacts = Pick<BrowserPick, 'kind' | 'box' | 'elements' | 'image'>;

async function pickedElement(
  cdp: Cdp,
  backendNodeId: number,
  filled: ReadonlySet<number>,
): Promise<PickFacts | null> {
  const sensitive = new Set([...(await sensitiveBackendIds(cdp)), ...filled]);
  const element = await describeElement(cdp, backendNodeId, {
    sensitive,
    htmlMax: BROWSER_PICK_HTML_MAX,
    styles: true,
  });
  if (!element) return null;
  return {
    kind: 'element',
    box: element.box,
    elements: [element],
    image: await cropped(cdp, padded(element.box), filled),
  };
}

async function pickedRegion(
  cdp: Cdp,
  box: BrowserBox,
  filled: ReadonlySet<number>,
): Promise<PickFacts> {
  const sensitive = new Set([...(await sensitiveBackendIds(cdp)), ...filled]);
  const elements: PickedElement[] = [];
  for (const backendNodeId of await nodesInside(cdp, box)) {
    const element = await describeElement(cdp, backendNodeId, {
      sensitive,
      htmlMax: REGION_HTML_MAX,
      styles: false,
    });
    if (element) elements.push(element);
  }
  return { kind: 'region', box, elements, image: await cropped(cdp, box, filled) };
}

export interface PickSession {
  cancel(): Promise<void>;
}

export async function startPick(
  cdp: Cdp,
  mode: PickMode,
  done: (picked: PickFacts | null) => void,
  filled: ReadonlySet<number> = new Set(),
): Promise<PickSession> {
  let finished = false;
  const stopListening = cdp.listen((method, params) => {
    if (finished) return;
    if (method === 'Overlay.inspectNodeRequested') {
      void finish(() => pickedElement(cdp, Number(params.backendNodeId), filled));
    }
    if (method === 'Overlay.screenshotRequested') {
      const viewport = params.viewport as BrowserBox;
      void finish(() => pickedRegion(cdp, viewport, filled));
    }
    if (method === 'Overlay.inspectModeCanceled') void finish(async () => null);
  });
  const leave = async () => {
    stopListening();
    await cdp.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => {});
    await cdp.send('Overlay.disable').catch(() => {});
  };
  const finish = async (gather: () => Promise<PickFacts | null>) => {
    if (finished) return;
    finished = true;
    await leave();
    done(await gather().catch(() => null));
  };
  await cdp.send('DOM.enable');
  await cdp.send('Overlay.enable');
  await cdp.send('Overlay.setInspectMode', {
    mode: mode === 'element' ? 'searchForNode' : 'captureAreaScreenshot',
    highlightConfig: HIGHLIGHT,
  });
  return { cancel: () => finish(async () => null) };
}
