import { layoutTree, type LayoutInput } from './tree-layout.ts';

self.onmessage = (event: MessageEvent<{ id: number; input: LayoutInput }>) => {
  const { id, input } = event.data;
  self.postMessage({ id, result: layoutTree(input) });
};
