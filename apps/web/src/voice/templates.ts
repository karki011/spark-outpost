type Node =
  | { kind: 'word'; word: string }
  | { kind: 'slot'; name: string }
  | { kind: 'optional'; body: Node[] }
  | { kind: 'choice'; options: Node[][] };

export type Template = Node[];
export type Captures = Readonly<Record<string, string[]>>;

const SLOT_MAX: Record<string, number> = { text: 60, ticket: 8 };
const LIST_SLOT_MAX = 6;

function slotMax(name: string): number {
  return SLOT_MAX[name] ?? LIST_SLOT_MAX;
}

export function parseTemplate(source: string): Template {
  let index = 0;

  const sequence = (closers: string): Node[][] => {
    const options: Node[][] = [[]];
    while (index < source.length) {
      const char = source[index]!;
      if (closers.includes(char)) return options;
      if (char === '|') {
        options.push([]);
        index += 1;
      } else if (char === '[' || char === '(') {
        index += 1;
        const inner = sequence(char === '[' ? ']' : ')');
        index += 1;
        options.at(-1)!.push(
          char === '['
            ? {
                kind: 'optional',
                body: inner.length === 1 ? inner[0]! : [{ kind: 'choice', options: inner }],
              }
            : { kind: 'choice', options: inner },
        );
      } else if (char === '{') {
        const end = source.indexOf('}', index);
        options.at(-1)!.push({ kind: 'slot', name: source.slice(index + 1, end) });
        index = end + 1;
      } else if (/\s/.test(char)) {
        index += 1;
      } else {
        const match = /^[a-z0-9']+/.exec(source.slice(index))!;
        options.at(-1)!.push({ kind: 'word', word: match[0].replace(/'/g, '') });
        index += match[0].length;
      }
    }
    return options;
  };

  const top = sequence('');
  return top.length === 1 ? top[0]! : [{ kind: 'choice', options: top }];
}

type State = { at: number; captures: Captures };

function* matchNode(node: Node, words: readonly string[], state: State): Generator<State> {
  switch (node.kind) {
    case 'word':
      if (words[state.at] === node.word) yield { ...state, at: state.at + 1 };
      return;
    case 'slot': {
      if (state.captures[node.name]) return;
      const most = Math.min(slotMax(node.name), words.length - state.at);
      for (let length = 1; length <= most; length += 1) {
        yield {
          at: state.at + length,
          captures: { ...state.captures, [node.name]: words.slice(state.at, state.at + length) },
        };
      }
      return;
    }
    case 'optional':
      yield* matchSequence(node.body, words, state);
      yield state;
      return;
    case 'choice':
      for (const option of node.options) yield* matchSequence(option, words, state);
  }
}

function* matchSequence(
  nodes: readonly Node[],
  words: readonly string[],
  state: State,
): Generator<State> {
  if (nodes.length === 0) {
    yield state;
    return;
  }
  const [first, ...rest] = nodes;
  for (const next of matchNode(first!, words, state)) yield* matchSequence(rest, words, next);
}

export function matchTemplate(template: Template, words: readonly string[]): Captures[] {
  const found: Captures[] = [];
  for (const state of matchSequence(template, words, { at: 0, captures: {} })) {
    if (state.at === words.length) found.push(state.captures);
    if (found.length >= 200) break;
  }
  return found;
}
