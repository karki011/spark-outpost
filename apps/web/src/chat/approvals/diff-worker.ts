import { buildDiff } from './diff-model.ts';

interface DiffJob {
  oldText: string | null;
  newText: string;
}

self.onmessage = (event: MessageEvent<DiffJob>) => {
  self.postMessage(buildDiff(event.data.oldText, event.data.newText));
};
