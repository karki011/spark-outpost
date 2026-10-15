export interface RefFacts {
  role: string;
  name: string;
  context: string;
}

export class RefNumbers {
  private next = 1;

  take(): number {
    const taken = this.next;
    this.next += 1;
    return taken;
  }

  peek(): number {
    return this.next;
  }
}

export const tabRefNumbers = new RefNumbers();

interface Binding {
  node: number;
  facts: RefFacts | null;
}

export type RefLookup =
  | { found: true; node: number; facts: RefFacts | null; refindable: boolean }
  | { found: false; reason: 'malformed' | 'earlier_page' | 'unknown' };

function refNumber(ref: string): number | null {
  const match = /^ref_(\d{1,12})$/.exec(ref.trim());
  return match ? Number(match[1]) : null;
}

export class RefMap {
  private readonly byNode = new Map<number, number>();
  private readonly byRef = new Map<number, Binding>();
  private readonly numbers: RefNumbers;
  private epochStart: number;
  private refindFrom: number;
  private documentId: number | null = null;
  private currentEpoch = 1;

  constructor(numbers: RefNumbers = new RefNumbers()) {
    this.numbers = numbers;
    this.epochStart = numbers.peek();
    this.refindFrom = this.epochStart;
  }

  get epoch(): number {
    return this.currentEpoch;
  }

  refFor(backendNodeId: number, facts: RefFacts | null = null): string {
    let ref = this.byNode.get(backendNodeId);
    if (ref === undefined) {
      ref = this.numbers.take();
      this.byNode.set(backendNodeId, ref);
      this.byRef.set(ref, { node: backendNodeId, facts });
    } else if (facts) {
      this.byRef.set(ref, { node: backendNodeId, facts });
    }
    return `ref_${ref}`;
  }

  nodeFor(ref: string): number | null {
    const found = this.lookup(ref);
    return found.found ? found.node : null;
  }

  lookup(ref: string): RefLookup {
    const number = refNumber(ref);
    if (number === null) return { found: false, reason: 'malformed' };
    const binding = this.byRef.get(number);
    if (binding) {
      return {
        found: true,
        node: binding.node,
        facts: binding.facts,
        refindable: number >= this.refindFrom,
      };
    }
    return { found: false, reason: number < this.epochStart ? 'earlier_page' : 'unknown' };
  }

  factsByNode(): Map<number, RefFacts> {
    const facts = new Map<number, RefFacts>();
    for (const binding of this.byRef.values()) {
      if (binding.facts) facts.set(binding.node, binding.facts);
    }
    return facts;
  }

  rebind(ref: string, node: number): void {
    const number = refNumber(ref);
    const binding = number === null ? undefined : this.byRef.get(number);
    if (number === null || !binding) return;
    if (this.byNode.get(binding.node) === number) this.byNode.delete(binding.node);
    if (!this.byNode.has(node)) this.byNode.set(node, number);
    this.byRef.set(number, { node, facts: binding.facts });
  }

  useDocument(documentId: number): boolean {
    const changed = this.documentId !== null && this.documentId !== documentId;
    if (changed) this.clear();
    this.documentId = documentId;
    return changed;
  }

  movedInPage(): void {
    this.refindFrom = this.numbers.peek();
  }

  clear(): void {
    this.byNode.clear();
    this.byRef.clear();
    this.documentId = null;
    this.currentEpoch += 1;
    this.epochStart = this.numbers.peek();
    this.refindFrom = this.epochStart;
  }
}
