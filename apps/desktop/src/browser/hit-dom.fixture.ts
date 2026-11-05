export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Style {
  visibility: string;
  opacity: string;
  pointerEvents: string;
  position: string;
  paddingLeft: string;
  paddingTop: string;
}

type Root = HitDocument | HitShadowRoot;
export type HitParent = HitElement | Root;

const PLAIN: Style = {
  visibility: 'visible',
  opacity: '1',
  pointerEvents: 'auto',
  position: 'static',
  paddingLeft: '0px',
  paddingTop: '0px',
};

function inside(box: Box, x: number, y: number): boolean {
  return x >= box.left && x < box.right && y >= box.top && y < box.bottom;
}

export class HitElement {
  readonly nodeType = 1;
  readonly style: Style;
  constructor(
    readonly ownerDocument: HitDocument,
    readonly tagName: string,
    readonly parentNode: HitElement | Root,
    readonly box: Box | null,
    style: Partial<Style>,
    private readonly attributes: Record<string, string>,
  ) {
    this.style = { ...PLAIN, ...style };
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  getRootNode(): Root {
    const parent = this.parentNode;
    return parent.nodeType === 1 ? parent.getRootNode() : parent;
  }

  inherited(name: 'visibility' | 'pointerEvents'): string {
    if (this.style[name] !== PLAIN[name]) return this.style[name];
    return this.styleParent()?.inherited(name) ?? PLAIN[name];
  }

  private styleParent(): HitElement | null {
    const parent = this.parentNode;
    if (parent.nodeType === 1) return parent;
    return parent.nodeType === 11 ? parent.host : null;
  }
}

abstract class HitRoot {
  constructor(protected readonly dom: HitDom) {}

  elementFromPoint(x: number, y: number): HitElement | null {
    const hit = this.dom.topmostAt(x, y);
    for (let node = hit; node;) {
      const root = node.getRootNode();
      if ((root as unknown) === this) return node;
      node = root.nodeType === 11 ? root.host : null;
    }
    return null;
  }
}

export class HitDocument extends HitRoot {
  readonly nodeType = 9;
  readonly parentNode = null;
  readonly defaultView = {
    frameElement: null,
    getComputedStyle: (element: HitElement) => ({
      ...element.style,
      visibility: element.inherited('visibility'),
      pointerEvents: element.inherited('pointerEvents'),
    }),
  };
}

export class HitShadowRoot extends HitRoot {
  readonly nodeType = 11;
  constructor(
    dom: HitDom,
    readonly host: HitElement,
  ) {
    super(dom);
  }

  get parentNode(): null {
    return null;
  }
}

export interface ElementOptions {
  box?: Box;
  style?: Partial<Style>;
  attributes?: Record<string, string>;
}

export class HitDom {
  readonly document = new HitDocument(this);
  private readonly painted: HitElement[] = [];

  add(tag: string, parent: HitParent, options: ElementOptions = {}): HitElement {
    const element = new HitElement(
      this.document,
      tag,
      parent,
      options.box ?? null,
      options.style ?? {},
      options.attributes ?? {},
    );
    this.painted.push(element);
    return element;
  }

  shadowOf(host: HitElement): HitShadowRoot {
    return new HitShadowRoot(this, host);
  }

  topmostAt(x: number, y: number): HitElement | null {
    for (const element of [...this.painted].reverse()) {
      if (!element.box || !inside(element.box, x, y)) continue;
      if (element.inherited('pointerEvents') === 'none') continue;
      return element;
    }
    return null;
  }
}
