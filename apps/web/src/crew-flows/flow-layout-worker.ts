import { layoutFlow, type FlowLayoutInput } from './flow-layout.ts';

self.onmessage = (event: MessageEvent<{ id: number; input: FlowLayoutInput }>) => {
  const { id, input } = event.data;
  self.postMessage({ id, result: layoutFlow(input) });
};
